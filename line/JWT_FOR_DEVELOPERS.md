# Line games — JWT for APK / WebView (same as under-6)

## Casino lobby

```
https://gunduata.tech/casino/?token=<JWT_ACCESS>&refresh=<JWT_REFRESH>
```

## Demo JWT (user: `line_demo` / `LineDemo@123`)

Access token:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzg3MDQ5MDM3LCJpYXQiOjE3ODY5NjI2MzcsImp0aSI6IjhiYjQ3MGIyYWU0NzQ1N2FiNmJmZDk1ZDdjOTBlZmE2IiwidXNlcl9pZCI6MTA3fQ.5Pu2yzyltM5av5uYPadezExAw90JgjCYBAUGngScMP0
```

Refresh token:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoicmVmcmVzaCIsImV4cCI6MTc4OTU1NDYzNywiaWF0IjoxNzg2OTYyNjM3LCJqdGkiOiI1OTRiYzU1MmE5NTA0OTEzYjUzOTE3YWJjMWZhNDQ1MSIsInVzZXJfaWQiOjEwN30.wguGXe0AoTMaqYe5BXv8cZbW-Ame5ESeaQ-ZmpnMNlo
```

## Ready-to-open URLs

```
https://gunduata.tech/casino/?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzg3MDQ5MDM3LCJpYXQiOjE3ODY5NjI2MzcsImp0aSI6IjhiYjQ3MGIyYWU0NzQ1N2FiNmJmZDk1ZDdjOTBlZmE2IiwidXNlcl9pZCI6MTA3fQ.5Pu2yzyltM5av5uYPadezExAw90JgjCYBAUGngScMP0

https://gunduata.tech/circle-game/?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzg3MDQ5MDM3LCJpYXQiOjE3ODY5NjI2MzcsImp0aSI6IjhiYjQ3MGIyYWU0NzQ1N2FiNmJmZDk1ZDdjOTBlZmE2IiwidXNlcl9pZCI6MTA3fQ.5Pu2yzyltM5av5uYPadezExAw90JgjCYBAUGngScMP0
https://gunduata.tech/stop-bar/?token=…
https://gunduata.tech/spin-dial/?token=…
https://gunduata.tech/mines-path/?token=…
https://gunduata.tech/dice-over-under/?token=…
https://gunduata.tech/color-match/?token=…
https://gunduata.tech/wheel-pockets/?token=…
https://gunduata.tech/wave-surf/?token=…
https://gunduata.tech/keno-pick/?token=…
https://gunduata.tech/hi-lo-cards/?token=…
```

Same pattern as under-6 / chicken-road / roulette: WebView opens URL with `?token=`.

## Mint a new token later

```bash
# on app server
docker exec dice_game_web python -c "
import os,django; os.environ.setdefault('DJANGO_SETTINGS_MODULE','dice_game.settings'); django.setup()
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
u=get_user_model().objects.get(username='line_demo')
r=RefreshToken.for_user(u); print(r.access_token)
"
```

Or login API: `POST https://gunduata.tech/api/auth/login/` with username/password.
