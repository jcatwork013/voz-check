// Package ai abstracts the moderation LLM behind a single Provider interface so
// the worker is agnostic to Gemini vs OpenAI. Each provider is asked to return a
// strict JSON verdict (see Result).
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Input is everything the model needs to judge one post.
type Input struct {
	SystemPrompt string
	Rules        string
	Title        string // discussion title (context); empty for replies
	Content      string // the post text under review
	Author       string
	PostType     string // "Bài viết mới" | "Bình luận"
}

// Result is the parsed verdict. Confidence is 0-100 (how sure the post violates).
type Result struct {
	Violation     bool     `json:"violation"`
	Confidence    float64  `json:"confidence"`
	Severity      string   `json:"severity"`
	Categories    []string `json:"categories"`
	Reason        string   `json:"reason"`
	MessageToUser string   `json:"message_to_user"`
	Raw           string   `json:"-"`
	// Token usage reported by the provider for this call (0 if unavailable).
	PromptTokens     int `json:"-"`
	CompletionTokens int `json:"-"`
	TotalTokens      int `json:"-"`
}

// Provider is one LLM backend.
type Provider interface {
	Name() string
	Model() string
	// Moderate returns the verdict for a single post.
	Moderate(ctx context.Context, in Input) (Result, error)
}

// New constructs a provider by name ("gemini" | "openai").
func New(provider, apiKey, model string) (Provider, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("missing AI api key")
	}
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "gemini", "google":
		if model == "" {
			model = "gemini-2.0-flash"
		}
		return &Gemini{apiKey: apiKey, model: model}, nil
	case "openai", "oai":
		if model == "" {
			model = "gpt-4o-mini"
		}
		return &OpenAI{apiKey: apiKey, model: model}, nil
	default:
		return nil, fmt.Errorf("unknown AI provider %q", provider)
	}
}

// buildUserPrompt assembles the rules + the post under review into the user turn.
func buildUserPrompt(in Input) string {
	var b strings.Builder
	b.WriteString("# NỘI QUY DIỄN ĐÀN\n")
	b.WriteString(in.Rules)
	b.WriteString("\n\n# NỘI DUNG CẦN KIỂM DUYỆT\n")
	b.WriteString("- Loại: ")
	if in.PostType != "" {
		b.WriteString(in.PostType)
	} else {
		b.WriteString("Bài viết")
	}
	b.WriteString("\n")
	if in.Author != "" {
		b.WriteString("- Tác giả: ")
		b.WriteString(in.Author)
		b.WriteString("\n")
	}
	if in.Title != "" {
		b.WriteString("- Tiêu đề chủ đề: ")
		b.WriteString(in.Title)
		b.WriteString("\n")
	}
	b.WriteString("- Nội dung:\n\"\"\"\n")
	b.WriteString(in.Content)
	b.WriteString("\n\"\"\"\n\n")
	b.WriteString("Hãy đánh giá và trả về DUY NHẤT object JSON theo schema đã mô tả.")
	return b.String()
}

// parseResult extracts and validates the JSON verdict from raw model text. It is
// tolerant of code fences / surrounding prose by scanning for the first balanced
// JSON object.
func parseResult(raw string) (Result, error) {
	jsonStr, ok := extractJSON(raw)
	if !ok {
		return Result{Raw: raw}, fmt.Errorf("no JSON object in model output: %.200s", raw)
	}
	var r Result
	if err := json.Unmarshal([]byte(jsonStr), &r); err != nil {
		return Result{Raw: raw}, fmt.Errorf("parse verdict json: %w", err)
	}
	r.Raw = raw
	// Clamp confidence to [0,100].
	if r.Confidence < 0 {
		r.Confidence = 0
	}
	if r.Confidence > 100 {
		r.Confidence = 100
	}
	if r.Severity == "" {
		r.Severity = "none"
	}
	return r, nil
}

// extractJSON returns the first balanced {...} block (handles fenced ```json).
func extractJSON(s string) (string, bool) {
	start := strings.IndexByte(s, '{')
	if start < 0 {
		return "", false
	}
	depth := 0
	inStr := false
	esc := false
	for i := start; i < len(s); i++ {
		ch := s[i]
		if inStr {
			switch {
			case esc:
				esc = false
			case ch == '\\':
				esc = true
			case ch == '"':
				inStr = false
			}
			continue
		}
		switch ch {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1], true
			}
		}
	}
	return "", false
}
