# Deploy STool len Render va test

File nay la huong dan duy nhat de dua STool len Render, sau do test backend tren Linux/Render thay vi Windows local.

## 1. Dieu kien truoc khi deploy

Can co:

- Tai khoan GitHub.
- Tai khoan Render: https://render.com
- Project da push len GitHub.
- Repo co cac file quan trong:
  - `package.json`
  - `package-lock.json`
  - `server.js`
  - `public/`
  - `render.yaml`

Render se chay STool nhu mot Node web service. Theo tai lieu Render, Node/Express app can build command va start command rieng; app cua minh dung `npm run render-build` va `npm start`. Render cung ho tro health check HTTP bang mot path nhu `/health`.

Tai lieu tham khao:

- Node/Express on Render: https://render.com/docs/deploy-node-express-app
- Health checks: https://render.com/docs/health-checks

## 2. Kiem tra local truoc khi push

Mo PowerShell tai thu muc project:

```powershell
cd E:\WINDOW\Project\STool
npm install
npm run check
git status --short
```

Neu `npm run check` khong bao loi cu phap thi co the push.

## 3. Push code len GitHub

Neu repo chua co remote:

```powershell
git init
git add .
git commit -m "Prepare Render deployment"
git branch -M main
git remote add origin https://github.com/<ten-user>/<ten-repo>.git
git push -u origin main
```

Neu repo da co remote:

```powershell
git add .
git commit -m "Prepare Render deployment"
git push
```

Luu y: `.gitignore` da ignore `node_modules/`, `downloads/`, `logs/`, `browser-profile/`, file PDF tam va cache Playwright. Khong push cac thu muc runtime nay.

## 4. Tao Web Service tren Render

Co 2 cach.

### Cach A: Dung Blueprint `render.yaml`

1. Vao Render Dashboard.
2. Chon `New`.
3. Chon `Blueprint`.
4. Connect GitHub repo STool.
5. Render se doc file `render.yaml`.
6. Xac nhan service `stool`.
7. Chon region gan ban nhat neu duoc.
8. Tao service.

File `render.yaml` hien tai:

```yaml
services:
  - type: web
    name: stool
    runtime: node
    buildCommand: npm run render-build
    startCommand: npm start
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: NODE_ENV
        value: production
      - key: PLAYWRIGHT_HEADLESS
        value: "true"
      - key: PLAYWRIGHT_BROWSERS_PATH
        value: "0"
```

### Cach B: Tao Web Service thu cong

1. Vao Render Dashboard.
2. Chon `New` -> `Web Service`.
3. Connect GitHub repo STool.
4. Chon branch `main`.
5. Cau hinh:

```text
Runtime: Node
Build Command: npm run render-build
Start Command: npm start
Health Check Path: /health
```

6. Them Environment Variables:

```text
NODE_ENV=production
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_BROWSERS_PATH=0
```

7. Bam `Create Web Service`.

## 5. Chon plan nao?

Playwright/Chromium can RAM kha nhieu. Neu plan free build hoac runtime bi crash, chuyen sang plan co RAM cao hon.

Trieu chung thieu RAM:

- Build dung lau roi fail khi `playwright install`.
- Log co `out of memory`, `killed`, `signal SIGKILL`.
- Service start duoc nhung khi bam tai thi browser crash.

Neu gap cac loi nay, vao Render service -> `Settings` -> doi instance type cao hon -> deploy lai.

## 6. Theo doi build log

Trong tab `Logs`, build thanh cong can thay cac buoc gan nhu:

```text
npm ci
npx playwright install --with-deps chromium
npm start
STool v2 ... http://localhost:<PORT>
```

Neu loi o `playwright install --with-deps chromium`, thu redeploy mot lan. Neu van loi, copy doan log loi do de sua tiep.

## 7. Kiem tra service song

Sau khi deploy xong, Render se cap URL dang:

```text
https://<ten-service>.onrender.com
```

Mo:

```text
https://<ten-service>.onrender.com/health
```

Neu thanh cong se thay JSON:

```json
{
  "ok": true,
  "service": "stool",
  "uptime": 123,
  "timestamp": "..."
}
```

Sau do mo trang chinh:

```text
https://<ten-service>.onrender.com
```

## 8. Test tai Studocu

1. Mo URL Render cua STool.
2. Dan link Studocu vao input.
3. Bam `Tai xuong PDF`.
4. Cho progress chay.
5. Neu thanh cong, nut tai file PDF se hien ra.

Nen test theo thu tu:

1. Link tai lieu ngan, it trang.
2. Link tai lieu trung binh.
3. Link tai lieu dai.

Dung ngay tai lieu 59 trang luc dau cung duoc, nhung neu fail thi kho tach loi hon.

## 9. Doc log khi test fail

Render Dashboard -> service `stool` -> tab `Logs`.

Can tim cac dong:

```text
[Job ...] Strategy A
[Job ...] Strategy B
browser-debug.log
fast-debug.log
cdn-debug.log
```

Trong repo, STool cung ghi log vao thu muc `logs/`, nhung tren Render filesystem co the la tam thoi. Uu tien xem Logs tren dashboard.

Y nghia loi hay gap:

```text
spawn EPERM
```

Thuong la loi Windows local. Tren Render/Linux loi nay khong nen xay ra. Neu van gap, Chromium dang bi moi truong runtime chan.

```text
Cloudflare ...
```

Studocu/Cloudflare chan request tu server. Can test lai, doi region/plan, hoac can thiet ke them flow khac.

```text
Fast mode chua tim du anh trang goc
```

Trang khong expose du anh/PDF source de ghep PDF dung. STool se dung de tranh tao PDF sai.

```text
Khong the lay noi dung tai lieu
```

Backend vao duoc trang nhung khong tim thay source/anh/page container hop le.

## 10. Luu y quan trong

- Bookmarklet da bi vo hieu hoa, nen flow test chi con: dan link -> bam tai -> thanh cong hoac fail ro rang.
- STool khong trien khai bypass premium/blur/paywall.
- Render co filesystem tam thoi, file PDF tao ra se bi xoa sau mot thoi gian ngan theo logic server.
- Neu muon luu cookie/browser profile lau dai, can cau hinh persistent disk tren Render. Ban co the test truoc khong can disk.

## 11. Checklist nhanh

Truoc khi deploy:

```powershell
npm run check
git status --short
git add .
git commit -m "Prepare Render deployment"
git push
```

Tren Render:

```text
Build Command: npm run render-build
Start Command: npm start
Health Check Path: /health
Env:
NODE_ENV=production
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_BROWSERS_PATH=0
```

Sau deploy:

```text
GET /health -> ok true
Mo trang chinh -> dan link -> bam tai
Neu fail -> xem Render Logs
```
