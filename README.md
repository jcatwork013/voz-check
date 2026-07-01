# VozCheck — Bot AI kiểm duyệt forum (Flarum + XenForo)

Bot AI tự động kiểm tra **bài viết & bình luận** khi người dùng đăng, dựa trên **nội quy + prompt** mày tự cấu hình, dùng **Gemini hoặc OpenAI**. Vi phạm vượt ngưỡng (mặc định 75%) → **tự ẩn bài + reply @mention cảnh báo** + cộng **strike** (phạt nguội). Trọn gói Docker, map `https://voz-check.9bricks.com`.

## Kiến trúc

```
voz-check.9bricks.com ─(Cloudflare:443 → SNI router → central-nginx:8443)─▶ voz-check.conf
        │
        ▼
  voz-check-web (nginx + React SPA)  ──/api/*──▶  voz-check-api (Go, :8080) ── SQLite (/data)
                                                       │
                                ┌──────────────────────┼─────────────────────────┐
                                ▼                       ▼                         ▼
                        Flarum poller            Ingest API (push)          AI provider
                        (pull mỗi ~10s)      ◀── XenForo Add-on ──▶      Gemini / OpenAI
```

- **Flarum** (adapter 1, *pull*): backend poll `/api/posts` mỗi ~10s, tự gọi API ẩn bài + reply.
- **XenForo** (adapter 2, *push*): **add-on** intercept lúc lưu post → gọi `/api/ingest/moderate` → enforce ngay trên XenForo (hợp diễn đàn lớn, real-time). Add-on ở thư mục [`xenforo-addon/`](./xenforo-addon).

## Thành phần
| Service | Image | Vai trò |
|---|---|---|
| `voz-check-api` | Go (multi-stage, pure-Go SQLite, no CGO) | REST API + Flarum poller + Ingest API + AI engine |
| `voz-check-web` | React + Vite + Tailwind → nginx | Dashboard quản trị |

## Chạy

```bash
cd /home/ubuntu/source/9bricks/voz-check
# .env đã có (VOZ_JWT_SECRET, VOZ_ADMIN_USER, VOZ_ADMIN_PASS) — chmod 600
docker compose up -d --build

# map domain (1 lần):
sudo cp deploy/voz-check.conf /home/ubuntu/nginx-central/conf.d/voz-check.conf
docker exec central-nginx nginx -t && docker exec central-nginx nginx -s reload
```

Mở `https://voz-check.9bricks.com` → đăng nhập bằng `VOZ_ADMIN_USER` / `VOZ_ADMIN_PASS` trong `.env`. **Đổi mật khẩu ngay** sau lần đầu.

## Cấu hình (trong dashboard)
1. **Kết nối Forum** → Flarum (base_url + admin user/pass, backend tự lấy token) hoặc XenForo (base_url + API key).
2. **Cấu hình AI** → chọn Gemini/OpenAI, nhập API key, model, ngưỡng %, bật `auto_hide` + `notify_user`.
3. **Nội quy & Prompt** → sửa nội quy + prompt (có sẵn bản mặc định tiếng Việt + nút khôi phục).
4. **Bật kiểm duyệt** ở Tổng quan.
5. (XenForo) **Tích hợp** → copy ingest key + URL vào option của add-on, cài add-on lên XenForo.

## Vận hành
- **Nhật ký**: xem mọi quyết định AI, ẩn/bỏ ẩn thủ công.
- **Phạt nguội**: mỗi vi phạm +1 strike; đủ ngưỡng → gắn cờ user. Nút **Quét lại bài cũ** (backfill) rà vi phạm trong content đã đăng.
- **Hướng dẫn**: trang `/guide` mô tả full quy trình.

## Lệnh hay dùng
```bash
docker compose logs -f api        # log bot
docker compose up -d --build      # rebuild
docker compose down               # tắt (giữ data)
./teardown.sh                     # gỡ sạch (containers + volume + route nginx)
```

## Bảo mật
- Dashboard yêu cầu đăng nhập (JWT, mật khẩu bcrypt trong SQLite).
- API key AI + token forum lưu server-side, **không** trả về client (chỉ trả cờ `has_key`/`connected`).
- Ingest key dùng cho handshake add-on ↔ backend, có thể regenerate.

> ⚠️ **XenForo = BETA**: code adapter + add-on theo doc chuẩn nhưng **cần forum XenForo thật để verify** (tên hook entity, chuyển `message_state`, gửi alert). Flarum đã verify trực tiếp trên `community.9bricks.com`.
