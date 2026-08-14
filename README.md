# 健康陪跑 Health Companion

這是「健康陪跑」Web App 的公開前端，部署於 GitHub Pages。

- Google Identity Services 登入
- Google Apps Script API
- 後端依 authenticated UserID 隔離健康資料
- 支援桌面與行動版介面、深淺色模式

前端不以 client 傳入的 UserID 作為授權依據；實際資料權限由 Apps Script 驗證 session 後決定。
