package store

// TokenUsage is the accumulated AI token consumption for one provider+model.
type TokenUsage struct {
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	Calls            int64  `json:"calls"`
	UpdatedAt        string `json:"updated_at"`
}

// AddTokenUsage records one AI call's token usage, accumulating per provider+model.
// Counts the call even when a provider returns no usage numbers.
func (s *Store) AddTokenUsage(provider, model string, prompt, completion, total int) error {
	if provider == "" {
		provider = "unknown"
	}
	_, err := s.db.Exec(`
		INSERT INTO token_usage(provider, model, prompt_tokens, completion_tokens, total_tokens, calls, updated_at)
		VALUES(?,?,?,?,?,1,?)
		ON CONFLICT(provider, model) DO UPDATE SET
			prompt_tokens     = prompt_tokens + excluded.prompt_tokens,
			completion_tokens = completion_tokens + excluded.completion_tokens,
			total_tokens      = total_tokens + excluded.total_tokens,
			calls             = calls + 1,
			updated_at        = excluded.updated_at`,
		provider, model, prompt, completion, total, nowUTC())
	return err
}

// ListTokenUsage returns per provider+model usage, highest total first.
func (s *Store) ListTokenUsage() ([]TokenUsage, error) {
	rows, err := s.db.Query(`
		SELECT provider, model, prompt_tokens, completion_tokens, total_tokens, calls, COALESCE(updated_at, '')
		FROM token_usage ORDER BY total_tokens DESC, calls DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TokenUsage
	for rows.Next() {
		var u TokenUsage
		if err := rows.Scan(&u.Provider, &u.Model, &u.PromptTokens, &u.CompletionTokens,
			&u.TotalTokens, &u.Calls, &u.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
