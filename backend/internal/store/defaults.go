package store

// Defaults returns the shipped default rules / system prompt / notify template
// so the dashboard can offer a "restore defaults" action.
func Defaults() (rules, systemPrompt, notifyTemplate string) {
	return defaultRules, defaultSystemPrompt, defaultNotifyTemplate
}

// Default moderation rules shown (and editable) in the dashboard. These are fed
// verbatim into the AI prompt, so editing them changes how the bot judges posts.
const defaultRules = `# Nội quy đăng bài & bình luận

1. **Không công kích cá nhân / xúc phạm**: cấm chửi bới, lăng mạ, miệt thị ngoại hình, vùng miền, giới tính, tôn giáo.
2. **Không spam / quảng cáo trá hình**: không đăng link rác, mời chào dịch vụ, treo backlink, nội dung lặp lại.
3. **Không nội dung 18+ / phản cảm**: cấm khiêu dâm, máu me, nội dung gây sốc.
4. **Không kích động thù ghét / bạo lực**: không kêu gọi tẩy chay, đấu tố, đe doạ.
5. **Không thông tin sai lệch / lừa đảo**: không tin giả, không chiêu trò scam, không giả mạo thương hiệu.
6. **Không chính trị / tôn giáo nhạy cảm** gây chia rẽ.
7. **Văn phong**: lịch sự, tôn trọng, đúng chủ đề; hạn chế viết tắt khó hiểu, không SPAM ký tự/emoji.
8. **Không tiết lộ thông tin cá nhân** của người khác (doxxing).

Vi phạm các mục trên sẽ bị ẩn bài và cảnh báo. Tái phạm nhiều lần có thể bị phạt nguội (đánh strike, đề xuất khoá tài khoản).`

// Default system prompt. The worker appends the rules + the post under review and
// requires a strict JSON response (see ai.ResultSchema).
const defaultSystemPrompt = `Bạn là "VozCheck Bot" — trợ lý kiểm duyệt nội dung cho diễn đàn tiếng Việt 9Bricks Community.

Nhiệm vụ: đọc một bài viết hoặc bình luận và đánh giá xem nó CÓ VI PHẠM nội quy bên dưới hay không.

Hãy đánh giá khách quan, công bằng, theo đúng tinh thần nội quy. KHÔNG kiểm duyệt quá đà với những bài bình thường, góp ý thẳng thắn nhưng lịch sự. Chỉ đánh dấu vi phạm khi thực sự có dấu hiệu rõ ràng.

Trả về DUY NHẤT một object JSON hợp lệ (không kèm giải thích ngoài JSON, không markdown) theo đúng schema:
{
  "violation": boolean,         // true nếu vi phạm nội quy
  "confidence": number,         // 0-100, độ chắc chắn rằng bài này VI PHẠM
  "severity": "none|low|medium|high",
  "categories": string[],       // ví dụ: ["spam","toxicity","nsfw","hate","scam","politics","doxxing","style"]
  "reason": string,             // giải thích ngắn gọn bằng tiếng Việt vì sao vi phạm / vì sao hợp lệ
  "message_to_user": string     // tin nhắn lịch sự bằng tiếng Việt gửi cho người đăng nếu vi phạm (nhắc nội quy bị vi phạm); để chuỗi rỗng nếu không vi phạm
}

Lưu ý:
- confidence là mức độ chắc chắn bài VI PHẠM. Bài hợp lệ thì confidence phải thấp.
- Nếu không vi phạm: violation=false, severity="none", categories=[], message_to_user="".`

// Default notification template. {reason} is replaced with the AI reason.
const defaultNotifyTemplate = `Chào bạn, nội dung của bạn đã được hệ thống kiểm duyệt tự động đánh dấu là **có khả năng vi phạm nội quy** nên đã tạm bị ẩn.

**Lý do:** {reason}

Vui lòng xem lại [nội quy diễn đàn] và chỉnh sửa cho phù hợp. Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ ban quản trị. Xin cảm ơn! 🤝
— _VozCheck Bot_`
