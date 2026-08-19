# Vortex 1

Same mechanics as Vortex 2, with **fewer / lower ring ratios**.

## Ratios (vs Vortex 2)

| Ring | Vortex 1 | Vortex 2 |
|------|----------|----------|
| Water | 1.5 → 4 (bonus to 6X) | 1.6 → 5 → 10 (bonus to 10X) |
| Earth | 2 → 5 → 12 (bonus to 20X) | 2.5 → 7.7 → 16 → 28 → 45 (bonus to 50X) |
| Fire | 3 → 10 → 25 → 50 (bonus to 100X) | 4 → … → 200 (bonus to 799X) |

## Layout

```
vortex-1/
  frontend/
  images/
  backend/
```

## Run

```bash
cd vortex-1/backend
python3 -m pip install -r requirements.txt
python3 manage.py migrate
python3 manage.py runserver 8001
```

Open **http://127.0.0.1:8001/**  
(Use port **8001** so Vortex 2 can stay on **8000**.)
