# Deploy STool len Render bang Docker

File nay la huong dan duy nhat de deploy STool len Render va test lai tren moi truong Linux.

## 1. Vi sao build cu bi fail?

Log cu co dong:

```text
Switching to root user to install dependencies...
Password: su: Authentication failure
Failed to install browsers
```

Nguyen nhan la lenh `npx playwright install --with-deps chromium` dang co gang cai system package bang quyen root trong native Node runtime cua Render. Moi truong build do khong cho nhap mat khau `su`, nen build fail.

Cach sua on dinh hon la deploy bang Docker. Render ho tro Dockerfile, va Docker cho phep minh dung san image Playwright da co Chromium va system dependencies can thiet.

Tai lieu tham khao:

- Render Docker: https://render.com/docs/docker
- Render Blueprint spec: https://render.com/docs/blueprint-spec

## 2. Cac file deploy da co san

Repo can co cac file nay:

```text
Dockerfile
.dockerignore
render.yaml
package.json
package-lock.json
server.js
public/
```

`render.yaml` hien tai dung Docker:

```yaml
services:
  - type: web
    name: stool
    runtime: docker
    dockerfilePath: ./Dockerfile
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: NODE_ENV
        value: production
      - key: PLAYWRIGHT_HEADLESS
        value: "true"
      - key: PLAYWRIGHT_BROWSERS_PATH
        value: /ms-playwright
```

`Dockerfile` dung image:

```text
mcr.microsoft.com/playwright:v1.61.1-jammy
```

Image nay da co Chromium cho dung Playwright `1.61.1`, nen khong can chay `playwright install --with-deps` tren Render nua.

Neu sau nay log Render bao `Please update docker image as well`, hay cap nhat version trong `Dockerfile` cho khop voi version `playwright` trong `package.json` va `package-lock.json`.

## 3. Kiem tra local truoc khi push

Mo PowerShell tai thu muc project:

```powershell
cd E:\WINDOW\Project\STool
npm run check
git status --short
```

Neu `npm run check` khong bao loi cu phap thi push len GitHub.

## 4. Push code len GitHub

Neu repo da co remote:

```powershell
git add .
git commit -m "Prepare Docker deployment for Render"
git push
```

Neu repo chua co remote:

```powershell
git init
git add .
git commit -m "Prepare Docker deployment for Render"
git branch -M main
git remote add origin https://github.com/<ten-user>/<ten-repo>.git
git push -u origin main
```

Luu y: `.gitignore` va `.dockerignore` da bo qua `node_modules/`, `downloads/`, `logs/`, `browser-profile/`, PDF tam, cache log va cac file local khong nen day len GitHub.

## 5. Neu da tao service Render bi fail truoc do

Neu service cu duoc tao voi Runtime `Node`, nen tao service moi bang Docker cho sach.

Ly do: service cu van co the giu cau hinh native Node va tiep tuc chay build command cu. Tao lai bang Docker se tranh viec Render lap lai loi `su: Authentication failure`.

Cach lam:

1. Vao Render Dashboard.
2. Mo service STool cu.
3. Neu no dang la native Node runtime, xoa service do hoac tao service moi.
4. Deploy lai theo muc 6 hoac muc 7 ben duoi.

## 6. Cach A: Deploy bang Blueprint

1. Vao Render Dashboard.
2. Chon `New`.
3. Chon `Blueprint`.
4. Connect GitHub repo STool.
5. Render se doc file `render.yaml`.
6. Xac nhan service `stool`.
7. Bam tao service.

Voi cach nay, Render se tu nhan:

```text
runtime: docker
dockerfilePath: ./Dockerfile
healthCheckPath: /health
```

Khong can dien Build Command hay Start Command.

## 7. Cach B: Tao Web Service thu cong

1. Vao Render Dashboard.
2. Chon `New` -> `Web Service`.
3. Connect GitHub repo STool.
4. Chon branch `main`.
5. O phan Runtime/Language, chon `Docker`.
6. Dockerfile path de mac dinh hoac dien:

```text
./Dockerfile
```

7. Health Check Path:

```text
/health
```

8. Them Environment Variables neu Render khong tu lay tu `render.yaml`:

```text
NODE_ENV=production
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
```

9. Bam `Create Web Service`.

Khong dien:

```text
Build Command
Start Command
```

Dockerfile da tu chay `npm ci --omit=dev` va `npm start`.

## 8. Kiem tra build log

Build thanh cong se co cac buoc gan nhu:

```text
Building Docker image
npm ci --omit=dev
npm start
STool v2 ... http://localhost:<PORT>
```

Neu van thay dong nay thi ban dang deploy sai runtime:

```text
npx playwright install --with-deps chromium
su: Authentication failure
```

Khi do hay xoa service cu va tao lai service Docker.

## 9. Kiem tra service song

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

## 10. Test tai lieu

1. Mo URL Render cua STool.
2. Dan link Studocu vao input.
3. Bam `Tai xuong PDF`.
4. Theo doi progress va Render Logs.
5. Neu thanh cong, tai file PDF ve kiem tra so trang va noi dung.

Nen test theo thu tu:

1. Tai lieu ngan.
2. Tai lieu trung binh.
3. Tai lieu 59 trang dang loi.

## 11. Loi hay gap sau khi deploy

```text
spawn EPERM
```

Loi nay thuong chi gap tren Windows local do antivirus/Windows Security chan Chromium. Tren Docker/Linux cua Render khong nen gap.

```text
out of memory
killed
signal SIGKILL
```

Instance Render thieu RAM. Can doi sang plan co RAM cao hon.

```text
Cloudflare
HTTP 403
HTTP 429
```

Studocu/Cloudflare dang chan request tu server. Thu redeploy, doi region/plan, hoac test lai sau.

```text
Khong the lay noi dung tai lieu
```

Backend vao duoc trang nhung khong tim thay noi dung hop le de tao PDF.

## 12. Checklist nhanh

Local:

```powershell
npm run check
git status --short
git add .
git commit -m "Prepare Docker deployment for Render"
git push
```

Render:

```text
Runtime: Docker
Dockerfile path: ./Dockerfile
Health Check Path: /health
```

Test:

```text
GET /health -> ok true
Mo trang chinh -> dan link -> bam tai
Neu fail -> xem Render Logs
```
