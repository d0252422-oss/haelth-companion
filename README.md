# 健康陪跑 Health Companion

這是「健康陪跑」Web App 的公開前端，部署於 GitHub Pages。

- Google Identity Services 登入
- LINE LIFF 登入與既有 UserID 綁定（需填入正式 LIFF ID）
- Google Apps Script API
- 後端依 authenticated UserID 隔離健康資料
- 支援桌面與行動版介面、深淺色模式

前端不以 client 傳入的 UserID 作為授權依據；實際資料權限由 Apps Script 驗證 session 後決定。

## LINE LIFF 設定

目前正式環境已連結 Provider「串接測試」中的 LINE OA「生活小幫手」：

- LINE Login Channel ID：`2011116657`
- LIFF ID：`2011116657-9SpSnQlN`
- LIFF Endpoint：`https://d0252422-oss.github.io/haelth-companion/`

1. 在 LINE Developers 建立或沿用 Login channel，新增 LIFF app。
2. Endpoint URL 設為 `https://d0252422-oss.github.io/haelth-companion/`，Scope 至少啟用 `openid` 與 `profile`；若要用驗證後的 email 自動對應既有帳號，再啟用 `email`。
3. 將 LINE Login Channel ID 寫入 Apps Script 的 Script Property：`LINE_LOGIN_CHANNEL_ID`。
4. 將 LIFF ID 填入 `index.html` 的 `CONFIG.LIFF_ID`，重新發布 GitHub Pages。

LINE ID token 只送往 Apps Script 驗證，不寫入 Sheet，也不輸出至 production console。健康資料的擁有者一律由後端 session 對應的 `UserID` 決定。
