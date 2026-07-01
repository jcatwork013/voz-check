package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Gemini calls Google's Generative Language API (generateContent).
type Gemini struct {
	apiKey string
	model  string
}

func (g *Gemini) Name() string  { return "gemini" }
func (g *Gemini) Model() string { return g.model }

func (g *Gemini) Moderate(ctx context.Context, in Input) (Result, error) {
	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		g.model, g.apiKey)

	reqBody := map[string]any{
		"systemInstruction": map[string]any{
			"parts": []map[string]string{{"text": in.SystemPrompt}},
		},
		"contents": []map[string]any{
			{"role": "user", "parts": []map[string]string{{"text": buildUserPrompt(in)}}},
		},
		"generationConfig": map[string]any{
			"temperature":      0.2,
			"responseMimeType": "application/json",
		},
	}
	b, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	hc := &http.Client{Timeout: 45 * time.Second}
	resp, err := hc.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("gemini %s: %.300s", resp.Status, string(raw))
	}

	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
			TotalTokenCount      int `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return Result{}, fmt.Errorf("gemini decode: %w", err)
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return Result{}, fmt.Errorf("gemini empty response (block=%s)", out.PromptFeedback.BlockReason)
	}
	res, err := parseResult(out.Candidates[0].Content.Parts[0].Text)
	res.PromptTokens = out.UsageMetadata.PromptTokenCount
	res.CompletionTokens = out.UsageMetadata.CandidatesTokenCount
	res.TotalTokens = out.UsageMetadata.TotalTokenCount
	return res, err
}
