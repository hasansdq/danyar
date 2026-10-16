# ─── گواهی‌های TURN/TLS (اختیاری) ───
# اگر می‌خواهید TURN روی TLS (پورت 5349) فعال شود:
#   ۱) cert.pem و key.pem را در همین پوشه بگذارید (مثلاً گواهی Let's Encrypt دامنه)
#   ۲) در .env مسیرها را تنظیم کنید:
#        TURN_CERT_FILE=/etc/coturn/cert.pem
#        TURN_KEY_FILE=/etc/coturn/key.pem
#   ۳) سرویس turn را دوباره بالا بیاورید: docker compose --profile turn up -d coturn
#
# بدون گواهی، سرویس با --no-tls --no-dtls اجرا می‌شود (پورت 5349 غیرفعال)
# و TURN از پورت 3478 کار می‌کند — این حالت هیچ تأثیری روی بقیه امکانات ندارد.
