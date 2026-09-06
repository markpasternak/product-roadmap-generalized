package main

import "testing"

const sample = "---\nid: TALK-001\ntitle: Foo\nproduct: Podcasts & Audiobooks\norder: 3\n---\n# Foo\n\n## Why it matters\nBecause.\n"

func TestParseRoundTrip(t *testing.T) {
	d := ParseDoc(sample)
	if d.FM["id"] != "TALK-001" || d.FM["order"] != "3" {
		t.Fatalf("bad parse: %+v", d.FM)
	}
	if d.Render() != sample {
		t.Fatalf("round-trip changed doc:\n%q\nvs\n%q", d.Render(), sample)
	}
}

func TestSet(t *testing.T) {
	d := ParseDoc(sample)
	d.Set("order", "7")
	d.Set("owner", "Mark")
	if d.FM["order"] != "7" || d.FM["owner"] != "Mark" {
		t.Fatalf("set failed: %+v", d.FM)
	}
	got := ParseDoc(d.Render())
	if got.FM["order"] != "7" || got.FM["owner"] != "Mark" || got.Body != d.Body {
		t.Fatalf("set did not persist through render")
	}
}

func TestNoFrontmatterRoundTrip(t *testing.T) {
	raw := "Just a body\nwith no frontmatter.\n"
	if got := ParseDoc(raw).Render(); got != raw {
		t.Fatalf("no-frontmatter round-trip changed doc:\n%q\nvs\n%q", got, raw)
	}
}

func TestYamlScalarQuotesUnsafeValues(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"colon-space", "'Music App': the plan", `"'Music App': the plan"`},
		{"leading dash", "-oops", `"-oops"`},
		{"leading hash", "#tag", `"#tag"`},
		{"leading bracket", "[oops]", `"[oops]"`},
		{"leading brace", "{oops}", `"{oops}"`},
		// A bare embedded quote doesn't itself need quoting (`Say "hi"` is
		// valid YAML plain scalar), but once a value needs quoting for
		// another reason (here: ": "), any quotes inside it must be escaped.
		{"colon-space with embedded quote", `Say: "hi"`, `"Say: \"hi\""`},
		{"empty", "", `""`},
		{"trailing space", "Music App ", `"Music App "`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := yamlScalar(c.in); got != c.want {
				t.Fatalf("yamlScalar(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestYamlScalarLeavesSafeValuesUnchanged(t *testing.T) {
	cases := []string{
		"Music App",
		"automation, ai",
		"3",
		"-5",
		"1.5",
		"true",
		"null",
		"Someone",
		// A quote character not at the start and not part of a ": "/" #"
		// pattern is valid inside a YAML plain scalar - no need to quote.
		`Say "hi"`,
	}
	for _, v := range cases {
		if got := yamlScalar(v); got != v {
			t.Fatalf("yamlScalar(%q) = %q, want unchanged", v, got)
		}
	}
}

func TestRenderQuotesUnsafeFrontmatterValues(t *testing.T) {
	d := ParseDoc(sample)
	d.Set("title", "'Music App': the plan")
	d.Set("tags", "automation, ai")
	out := d.Render()
	if !containsLine(out, `title: "'Music App': the plan"`) {
		t.Fatalf("expected quoted title in render, got:\n%s", out)
	}
	if !containsLine(out, "tags: automation, ai") {
		t.Fatalf("expected unquoted comma tags in render, got:\n%s", out)
	}
	if !containsLine(out, "order: 3") {
		t.Fatalf("expected unquoted numeric order in render, got:\n%s", out)
	}
}

func TestRenderParseRoundTripsThroughEditService(t *testing.T) {
	// ParseDoc's line parsing is a naive strings.Cut on the first ":", so it
	// does not do general YAML parsing. But it does specifically recognize
	// and unescape the double-quoted form that Render()/yamlScalar produces
	// (see unquoteYAML), so a value that required quoting still comes back
	// byte-for-byte through ParseDoc(Render(doc)) - not just through a real
	// YAML parser. This matters because gitstore.go/sync.go re-read files
	// with ParseDoc on every subsequent edit: without unquoting, a quoted
	// value would gain an extra layer of escaping on every edit thereafter.
	cases := []string{
		"'Music App': the plan",
		`Say: "hi"`,
		"-oops",
		"#tag",
		"",
	}
	for _, want := range cases {
		d := ParseDoc(sample)
		d.Set("title", want)
		rendered := d.Render()

		reparsed := ParseDoc(rendered)
		if reparsed.FM["title"] != want {
			t.Fatalf("round-trip lost value: set %q, got back %q (rendered: %q)", want, reparsed.FM["title"], rendered)
		}

		// Re-rendering the reparsed doc must be stable (no escalating
		// quoting on repeated edit-service read/write cycles).
		if reparsed.Render() != rendered {
			t.Fatalf("re-render of reparsed doc is not stable:\n%q\nvs\n%q", reparsed.Render(), rendered)
		}
	}
}

func containsLine(doc, line string) bool {
	for _, l := range splitLines(doc) {
		if l == line {
			return true
		}
	}
	return false
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
