# استقرار دانیار روی VPS دارای DirectAdmin

درگاه فقط روی `127.0.0.1:3034` باز می‌شود. پورت‌های 80 و 443 آزاد می‌مانند و SSL با DirectAdmin است. Caddy داخلی چت و کلاس آنلاین را به سرویس‌های مربوط هدایت می‌کند.

## پیش‌نیاز
Docker، Compose نسخه 2.20 یا جدیدتر و Python 3. برای ساخت اولیه RAM کافی و دسترسی به رجیستری‌ها لازم است.

## راه‌اندازی
```bash
cp .env.example .env
chmod 600 .env
openssl rand -base64 32
openssl rand -base64 32
```
دو کلید تولیدشده را به NEXTAUTH_SECRET و SOCKET_AUTH_SECRET اختصاص دهید. ADMIN_PASSWORD باید حداقل ۸ کاراکتر شامل حرف کوچک، بزرگ و عدد داشته باشد. NEXTAUTH_URL را https://your-domain.com تنظیم کنید.

برای نصب خالی:
```bash
./deploy.sh
```
برای انتقال دیتابیس و آپلودهای موجود در بسته، قبل از اولین اجرا:
```bash
source ./docker-common.sh
"${compose[@]}" build
./import-data.sh
./deploy.sh
```
اسکریپت انتقال فقط Volumeهای خالی را می‌پذیرد. دیتابیس SQLite باید در مبدأ بسته و بدون نویسنده فعال کپی شده باشد. این فایل پروژه شامل اطلاعات فعلی است؛ آن را عمومی منتشر نکنید.

## اتصال دامنه در DirectAdmin
ابتدا SSL دامنه را در DirectAdmin فعال کنید. تنظیمات پروکسی را در بخش Custom HTTPD Configuration دامنه ثبت کنید تا بازنویسی تنظیمات آن‌ها را حذف نکند.

برای Apache، در تنظیمات VirtualHost دامنه (HTTP و HTTPS)، با فعال بودن ماژول‌های proxy، proxy_http، proxy_wstunnel و rewrite:
```apache
ProxyPreserveHost On
RewriteEngine On
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule ^/(.*)$ ws://127.0.0.1:3034/$1 [P,L]
ProxyPass / http://127.0.0.1:3034/
ProxyPassReverse / http://127.0.0.1:3034/
```
در VirtualHost مربوط به HTTPS، با ماژول headers:
```apache
RequestHeader set X-Forwarded-Proto "https"
```
اگر سرور Nginx دارد، در location دامنه:
```nginx
location / {
    proxy_pass http://127.0.0.1:3034;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    client_max_body_size 30m;
}
```
در حالت nginx_apache، تنظیمات پروکسی باید در لایه Nginx دامنه هم اعمال شود. قبل از reload، صحت تنظیمات وب‌سرور را با apachectl configtest یا nginx -t بررسی کنید. قواعد پروکسی باید بر قواعد پیش‌فرض همان دامنه مقدم باشند؛ محل درج به قالب DirectAdmin بستگی دارد.

## PostgreSQL اختیاری
DB_PROVIDER=postgres، DATABASE_URL و POSTGRES_PASSWORD را در .env تنظیم کنید. URL باید از نام میزبان postgres و پورت 5432 استفاده کند. deploy.sh فایل تکمیلی را خودکار انتخاب می‌کند. در اجرای دستی:
```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build --wait
```
تغییر provider اطلاعات SQLite را به PostgreSQL انتقال نمی‌دهد. برای DB قدیمی بدون تاریخچه Migration، ابتدا تطبیق ساختار و baseline دستی لازم است؛ اسکریپت دیگر تمام Migrationها را خودکار علامت نمی‌زند.

## بکاپ، بازیابی و به‌روزرسانی
```bash
./backup.sh
./restore.sh backups/daniyar-TIMESTAMP.tar.gz
./deploy.sh
curl http://127.0.0.1:3034/api/health
```
بکاپ برای سازگاری اطلاعات، سرویس‌های برنامه را موقتاً متوقف می‌کند و حتی در خطا دوباره راه می‌اندازد. بازیابی مخرب است و تأیید می‌خواهد؛ در خطای بازیابی سرویس‌ها متوقف می‌مانند تا بررسی کنید. بکاپ‌ها شامل داده حساس هستند و باید خارج از VPS هم نگهداری شوند. هرگز docker compose down -v اجرا نکنید مگر قصد حذف داده‌ها را داشته باشید.

برای کلاس ویدئویی پشت NAT، TURN معتبر تنظیم کنید. تنظیمات SMS و VAPID در Compose منتقل می‌شوند. بعد از نصب، ورود، ارسال پیام، آپلود، نمایش فایل آپلودشده، تماس، بکاپ و بازیابی را بررسی کنید.

## اعتبارسنجی این بسته
اسکریپت‌های Bash و ساختار YAML به صورت محلی بررسی شده‌اند. ساخت و اجرای کانتینرها در محیط تهیه این بسته به علت نبود Docker/Bun انجام نشده است.
