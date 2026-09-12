package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

func appJWT(appID string, key *rsa.PrivateKey, now time.Time) (string, error) {
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	header := b64([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload := b64([]byte(fmt.Sprintf(`{"iat":%d,"exp":%d,"iss":"%s"}`, now.Unix()-60, now.Add(9*time.Minute).Unix(), appID)))
	signingInput := header + "." + payload
	h := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, h[:])
	if err != nil {
		return "", err
	}
	return signingInput + "." + b64(sig), nil
}

type GitHub struct {
	cfg               Config
	key               *rsa.PrivateKey
	httpc             *http.Client
	mu                sync.Mutex
	repoMu            sync.Mutex
	itemsMu           sync.Mutex
	itemSnapshots     map[string]map[string]RepoFile
	itemSnapshotOrder []string
	instTok           string
	instExp           time.Time
}

func NewGitHub(cfg Config) (*GitHub, error) {
	raw, err := os.ReadFile(cfg.PrivateKeyFile)
	if err != nil {
		return nil, fmt.Errorf("read private key: %w", err)
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, fmt.Errorf("private key: not PEM")
	}
	var key *rsa.PrivateKey
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		key = k
	} else {
		k2, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err2 != nil {
			return nil, fmt.Errorf("parse private key: %w", err2)
		}
		rk, ok := k2.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("private key is not RSA")
		}
		key = rk
	}
	return &GitHub{cfg: cfg, key: key, httpc: &http.Client{Timeout: 20 * time.Second}}, nil
}

func (g *GitHub) installationToken(ctx context.Context) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if time.Now().Before(g.instExp.Add(-5*time.Minute)) && g.instTok != "" {
		return g.instTok, nil
	}
	jwt, err := appJWT(g.cfg.AppID, g.key, time.Now())
	if err != nil {
		return "", err
	}
	url := "https://api.github.com/app/installations/" + g.cfg.InstallationID + "/access_tokens"
	req, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	res, err := g.httpc.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 201 {
		return "", fmt.Errorf("installation token: HTTP %d", res.StatusCode)
	}
	var body struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", err
	}
	g.instTok, g.instExp = body.Token, body.ExpiresAt
	return g.instTok, nil
}

// helper for building api URLs
func ghURL(path string) string {
	return "https://api.github.com" + strings.TrimPrefix(path, "https://api.github.com")
}

func (g *GitHub) exchangeCode(ctx context.Context, code string) (string, error) {
	form := "client_id=" + g.cfg.ClientID + "&client_secret=" + g.cfg.ClientSecret + "&code=" + code
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://github.com/login/oauth/access_token", strings.NewReader(form))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := g.httpc.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.AccessToken == "" {
		return "", fmt.Errorf("oauth exchange failed: %s", body.Error)
	}
	return body.AccessToken, nil
}

func (g *GitHub) apiGet(ctx context.Context, tok, path string, out any) (int, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com"+path, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	res, err := g.httpc.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if out != nil && res.StatusCode/100 == 2 {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode, nil
}

func (g *GitHub) apiPost(ctx context.Context, tok, method, path string, body, out any) (int, error) {
	var rdr *strings.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = strings.NewReader(string(b))
	} else {
		rdr = strings.NewReader("")
	}
	req, _ := http.NewRequestWithContext(ctx, method, "https://api.github.com"+path, rdr)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")
	res, err := g.httpc.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if out != nil && res.StatusCode/100 == 2 {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode, nil
}

// listItems returns all content/items/**/*.md keyed by frontmatter id.
func (g *GitHub) listItems(ctx context.Context) (map[string]RepoFile, error) {
	return g.listItemsFromGit(ctx)
}

// ActivityCommit is a single commit touching the activity feed's watched path.
type ActivityCommit struct {
	SHA     string `json:"sha"`
	HTMLURL string `json:"htmlUrl"`
	Message string `json:"message"`
	Date    string `json:"date"`
}

// listCommits returns the most recent commits touching path, newest first, via
// GitHub's commits API. The commit author is the GitHub App bot (commitFiles
// never sets an author) — the human editor lives in the message's "(via
// <login>)" and is parsed client-side, so the message is passed through as-is.
func (g *GitHub) listCommits(ctx context.Context, path string, perPage int) ([]ActivityCommit, error) {
	tok, err := g.installationToken(ctx)
	if err != nil {
		return nil, err
	}
	var raw []struct {
		SHA     string `json:"sha"`
		HTMLURL string `json:"html_url"`
		Commit  struct {
			Message string `json:"message"`
			Author  struct {
				Date string `json:"date"`
			} `json:"author"`
			Committer struct {
				Date string `json:"date"`
			} `json:"committer"`
		} `json:"commit"`
	}
	q := "/repos/" + g.cfg.Repo + "/commits?path=" + url.QueryEscape(path) + "&per_page=" + strconv.Itoa(perPage)
	code, err := g.apiGet(ctx, tok, q, &raw)
	if err != nil {
		return nil, err
	}
	if code/100 != 2 {
		return nil, fmt.Errorf("list commits: HTTP %d", code)
	}
	out := make([]ActivityCommit, 0, len(raw))
	for _, c := range raw {
		date := c.Commit.Author.Date
		if date == "" {
			date = c.Commit.Committer.Date
		}
		out = append(out, ActivityCommit{SHA: c.SHA, HTMLURL: c.HTMLURL, Message: c.Commit.Message, Date: date})
	}
	return out, nil
}

// treeEntries builds git-tree entries: writes carry `content` and NO `sha`;
// deletes carry an explicit `sha:null` and NO `content`.
func treeEntries(write []RepoFile, del []string) []map[string]any {
	entries := []map[string]any{}
	for _, f := range write {
		entries = append(entries, map[string]any{"path": f.Path, "mode": "100644", "type": "blob", "content": f.Content})
	}
	for _, p := range del {
		entries = append(entries, map[string]any{"path": p, "mode": "100644", "type": "blob", "sha": nil})
	}
	return entries
}

// commitFiles applies writes+deletes as one commit on main via the tree API.
func (g *GitHub) commitFiles(ctx context.Context, msg, authorLogin string, write []RepoFile, del []string) (string, error) {
	tok, err := g.installationToken(ctx)
	if err != nil {
		return "", err
	}
	repo := "/repos/" + g.cfg.Repo
	var ref struct {
		Object struct{ SHA string } `json:"object"`
	}
	if code, err := g.apiGet(ctx, tok, repo+"/git/ref/heads/main", &ref); err != nil || code != 200 {
		return "", fmt.Errorf("get ref: HTTP %d %v", code, err)
	}
	var head struct {
		Tree struct{ SHA string } `json:"tree"`
	}
	if code, err := g.apiGet(ctx, tok, repo+"/git/commits/"+ref.Object.SHA, &head); err != nil || code != 200 {
		return "", fmt.Errorf("get head commit: HTTP %d", code)
	}
	entries := treeEntries(write, del)
	var newTree struct{ SHA string }
	if code, err := g.apiPost(ctx, tok, "POST", repo+"/git/trees",
		map[string]any{"base_tree": head.Tree.SHA, "tree": entries}, &newTree); err != nil || code != 201 {
		return "", fmt.Errorf("create tree: HTTP %d %v", code, err)
	}
	var commit struct{ SHA string }
	if code, err := g.apiPost(ctx, tok, "POST", repo+"/git/commits", map[string]any{
		"message": msg, "tree": newTree.SHA, "parents": []string{ref.Object.SHA},
	}, &commit); err != nil || code != 201 {
		return "", fmt.Errorf("create commit: HTTP %d %v", code, err)
	}
	if code, err := g.apiPost(ctx, tok, "PATCH", repo+"/git/refs/heads/main", map[string]any{"sha": commit.SHA}, nil); err != nil || code != 200 {
		return "", fmt.Errorf("update ref: HTTP %d %v", code, err)
	}
	return commit.SHA, nil
}

// collaboratorCanPush re-checks login's CURRENT push access via the GitHub
// App installation token (KTD6/R8) — the signed session only proves who
// signed in, not that their access hasn't since been revoked, and the
// session doesn't carry the user's own OAuth token, so the App token is the
// only credential available for this recheck. Fail-closed: any non-2xx
// response (404 = no longer a collaborator, or any other GitHub-side denial)
// is treated as "cannot push"; only a genuine transport/request error is
// returned separately so the caller can distinguish "denied" from "GitHub is
// unreachable" (502) instead of silently deny-by-default on an outage.
// GitHub's collaborator-permission endpoint reports one of
// admin/write/read/none; "write" is that API's current name for what the
// UI/older docs call "push" — both are treated as sufficient.
func (g *GitHub) collaboratorCanPush(ctx context.Context, login string) (bool, error) {
	tok, err := g.installationToken(ctx)
	if err != nil {
		return false, err
	}
	var body struct {
		Permission string `json:"permission"`
	}
	code, err := g.apiGet(ctx, tok, "/repos/"+g.cfg.Repo+"/collaborators/"+url.PathEscape(login)+"/permission", &body)
	if err != nil {
		return false, err
	}
	if code/100 != 2 {
		return false, nil
	}
	return body.Permission == "admin" || body.Permission == "write", nil
}

// DeployRun is the latest deploy.yml run on main, mapped to the shape the
// client understands (KTD4). It always reflects the LATEST run — callers
// re-fetch rather than pin a run id, since git shas/run ids aren't ordered
// and a superseded run can be cancelled by a newer one.
type DeployRun struct {
	Status         string `json:"status"`
	Conclusion     string `json:"conclusion"`
	HeadSHA        string `json:"headSha"`
	HTMLURL        string `json:"htmlUrl"`
	IncludesCommit bool   `json:"includesCommit,omitempty"`
	Live           bool   `json:"live,omitempty"`
}

// latestDeployRun returns the most recent deploy.yml run on main via the
// Actions API (App token; needs the actions:read permission on the
// installation — verify this is granted, per the plan's open question). If
// there are no runs at all (e.g. a commit only touched path-filtered files),
// it returns a zero-value DeployRun with a nil error — "no run yet" is a
// valid, distinct state for the client to interpret, not a server error.
func (g *GitHub) latestDeployRun(ctx context.Context) (DeployRun, error) {
	tok, err := g.installationToken(ctx)
	if err != nil {
		return DeployRun{}, err
	}
	var body struct {
		WorkflowRuns []struct {
			Status     string `json:"status"`
			Conclusion string `json:"conclusion"`
			HeadSHA    string `json:"head_sha"`
			HTMLURL    string `json:"html_url"`
		} `json:"workflow_runs"`
	}
	q := "/repos/" + g.cfg.Repo + "/actions/workflows/deploy.yml/runs?branch=main&per_page=1"
	code, err := g.apiGet(ctx, tok, q, &body)
	if err != nil {
		return DeployRun{}, err
	}
	if code/100 != 2 {
		return DeployRun{}, fmt.Errorf("list workflow runs: HTTP %d", code)
	}
	if len(body.WorkflowRuns) == 0 {
		return DeployRun{}, nil
	}
	r := body.WorkflowRuns[0]
	return DeployRun{Status: r.Status, Conclusion: r.Conclusion, HeadSHA: r.HeadSHA, HTMLURL: r.HTMLURL}, nil
}

// userCanPush reads the user's own permission on the repo via their token.
func (g *GitHub) userCanPush(ctx context.Context, userToken string) (string, bool, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+g.cfg.Repo, nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	res, err := g.httpc.Do(req)
	if err != nil {
		return "", false, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", false, nil
	}
	var body struct {
		Permissions struct{ Push, Admin, Maintain bool } `json:"permissions"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", false, err
	}
	// login from /user
	ureq, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	ureq.Header.Set("Authorization", "Bearer "+userToken)
	ureq.Header.Set("Accept", "application/vnd.github+json")
	ures, err := g.httpc.Do(ureq)
	if err != nil {
		return "", false, err
	}
	defer ures.Body.Close()
	var u struct {
		Login string `json:"login"`
	}
	json.NewDecoder(ures.Body).Decode(&u)
	ok := body.Permissions.Push || body.Permissions.Admin || body.Permissions.Maintain
	return u.Login, ok, nil
}
