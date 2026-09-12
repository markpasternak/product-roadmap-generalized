package main

import (
	"regexp"
	"strconv"
	"strings"
)

type Doc struct {
	Keys  []string
	FM    map[string]string
	Body  string
	HasFM bool
}

func ParseDoc(raw string) Doc {
	d := Doc{FM: map[string]string{}}
	if !strings.HasPrefix(raw, "---\n") {
		d.Body = raw
		return d
	}
	rest := raw[len("---\n"):]
	end := strings.Index(rest, "\n---\n")
	if end < 0 {
		d.Body = raw
		return d
	}
	fmBlock := rest[:end]
	d.Body = rest[end+len("\n---\n"):]
	for _, line := range strings.Split(fmBlock, "\n") {
		k, v, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		key := strings.TrimSpace(k)
		d.Keys = append(d.Keys, key)
		d.FM[key] = unquoteYAML(strings.TrimSpace(v))
	}
	d.HasFM = true
	return d
}

func (d *Doc) Set(key, val string) {
	if _, exists := d.FM[key]; !exists {
		d.Keys = append(d.Keys, key)
	}
	d.FM[key] = val
}

func (d *Doc) Unset(key string) {
	delete(d.FM, key)
	next := d.Keys[:0]
	for _, existing := range d.Keys {
		if existing != key {
			next = append(next, existing)
		}
	}
	d.Keys = next
}

func (d Doc) Render() string {
	if !d.HasFM {
		return d.Body
	}
	var b strings.Builder
	b.WriteString("---\n")
	for _, k := range d.Keys {
		b.WriteString(k)
		b.WriteString(": ")
		b.WriteString(yamlScalar(d.FM[k]))
		b.WriteString("\n")
	}
	b.WriteString("---\n")
	b.WriteString(d.Body)
	return b.String()
}

// yamlIndicatorChars are the leading characters that YAML reserves for its
// own syntax. A plain scalar starting with one of these would be
// misinterpreted (or rejected) by a YAML parser.
const yamlIndicatorChars = "-?:,[]{}#&*!|>'\"%@`"

// plainScalarLookalike matches values that read as YAML numbers or
// keywords (e.g. "3", "-5", "1.5", "true", "null"). These are left
// unquoted even though they may start with a yamlIndicatorChars byte
// (like a leading "-" on a negative number), so numeric/boolean
// frontmatter fields such as order keep their scalar type.
var plainScalarLookalike = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$|^(true|false|null)$`)

// yamlScalar returns v unchanged if it is already a safe YAML plain scalar,
// or a double-quoted, escaped string otherwise. This is intentionally
// minimal quoting (not full YAML canonicalization): it only quotes values
// that would otherwise corrupt or fail to parse as YAML, so that existing
// unquoted forms (numbers, comma-separated tags, plain words) keep their
// exact on-disk representation and type.
func yamlScalar(v string) string {
	if needsYAMLQuoting(v) {
		return quoteYAMLString(v)
	}
	return v
}

func needsYAMLQuoting(v string) bool {
	if v == "" {
		return true
	}
	if v != strings.TrimSpace(v) {
		return true
	}
	if plainScalarLookalike.MatchString(v) {
		return false
	}
	if strings.ContainsRune(yamlIndicatorChars, rune(v[0])) {
		return true
	}
	if strings.Contains(v, ": ") || strings.HasSuffix(v, ":") {
		return true
	}
	if strings.Contains(v, " #") {
		return true
	}
	for _, r := range v {
		if r < 0x20 {
			return true
		}
	}
	return false
}

// unquoteYAML reverses quoteYAMLString: if v is wrapped in double quotes
// (the form yamlScalar/Render produces for unsafe values), it strips the
// quotes and unescapes the contents so ParseDoc(Render(doc)) recovers the
// original value the caller passed to Set. Values that aren't quoted (the
// common case - plain titles, numbers, comma-separated tags) pass through
// untouched, so existing unquoted content files are unaffected.
func unquoteYAML(v string) string {
	if len(v) < 2 || v[0] != '"' || v[len(v)-1] != '"' {
		return v
	}
	inner := v[1 : len(v)-1]
	var b strings.Builder
	for i := 0; i < len(inner); i++ {
		c := inner[i]
		if c != '\\' || i+1 >= len(inner) {
			b.WriteByte(c)
			continue
		}
		i++
		switch inner[i] {
		case '\\':
			b.WriteByte('\\')
		case '"':
			b.WriteByte('"')
		case 'n':
			b.WriteByte('\n')
		case 't':
			b.WriteByte('\t')
		case 'r':
			b.WriteByte('\r')
		case 'u':
			if i+4 < len(inner) {
				if n, err := strconv.ParseUint(inner[i+1:i+5], 16, 8); err == nil {
					b.WriteByte(byte(n))
					i += 4
					continue
				}
			}
			b.WriteByte('u')
		default:
			b.WriteByte(inner[i])
		}
	}
	return b.String()
}

func quoteYAMLString(v string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range v {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\t':
			b.WriteString(`\t`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				const hex = "0123456789abcdef"
				b.WriteByte(hex[(r>>4)&0xf])
				b.WriteByte(hex[r&0xf])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}
