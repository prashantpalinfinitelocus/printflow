"""Create the schema, sample PSDs, store master, users and a starter CSV.

Idempotent: re-running updates existing rows instead of duplicating them.

Run:  python -m scripts.seed
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import PrintFormat, Role, Store, User  # noqa: E402
from app.security import hash_password  # noqa: E402
from scripts.make_sample_psds import build_all  # noqa: E402

STORES = [
    {"code": "MUM01", "name": "Bandra Flagship", "city": "Mumbai"},
    {"code": "DEL01", "name": "Connaught Place", "city": "New Delhi"},
    {"code": "BLR01", "name": "Indiranagar", "city": "Bengaluru"},
]

OPERATORS = [
    {"email": "mumbai@printflow.local", "full_name": "Mumbai Operator", "store": "MUM01"},
    {"email": "delhi@printflow.local", "full_name": "Delhi Operator", "store": "DEL01"},
    {"email": "bengaluru@printflow.local", "full_name": "Bengaluru Operator", "store": "BLR01"},
]
OPERATOR_PASSWORD = "operator123"

SAMPLE_CSV = """order_id,store_id,amount,print_format,text
ORD-1001,MUM01,499.00,GIFT_TAG,"Happy Birthday, Riya!"
ORD-1002,MUM01,1250.50,THANK_YOU,"Thank you for shopping with us"
ORD-1003,DEL01,899.00,BOTTLE_LABEL,"Share with Arjun"
ORD-1004,DEL01,349.75,GIFT_TAG,"With love, from the Sharma family"
ORD-1005,BLR01,2100.00,THANK_YOU,"Congratulations on the new home!"
ORD-1006,BLR01,650.00,BOTTLE_LABEL,"Cheers, Team Indiranagar"
ORD-1007,MUM01,180.00,GIFT_TAG,"Get well soon"
ORD-1008,BLR01,4999.00,THANK_YOU,"A very long dedication that has to wrap across several lines so the auto-fit logic has something real to chew on"
"""


def main() -> None:
    settings.ensure_dirs()
    print("Creating schema...")
    Base.metadata.create_all(bind=engine)

    print("Generating sample PSD templates...")
    designs = build_all()

    db = SessionLocal()
    try:
        print("Seeding stores...")
        for row in STORES:
            store = db.scalar(select(Store).where(Store.code == row["code"]))
            if store is None:
                db.add(Store(**row))
                print(f"  + {row['code']}  {row['name']}")
            else:
                store.name, store.city = row["name"], row["city"]
        db.commit()

        print("Seeding print formats...")
        for design in designs:
            fmt = db.scalar(select(PrintFormat).where(PrintFormat.code == design["code"]))
            fields = {
                "name": design["name"],
                "psd_path": design["psd_path"],
                "width_px": design["width_px"],
                "height_px": design["height_px"],
                "dpi": design["dpi"],
                "text_box": design["text_box"],
                "font_size": design["font_size"],
                "font_color": design["font_color"],
                "align": "center",
            }
            if fmt is None:
                db.add(PrintFormat(code=design["code"], **fields))
                print(f"  + {design['code']}")
            else:
                for key, value in fields.items():
                    setattr(fmt, key, value)
        db.commit()

        print("Seeding users...")
        admin = db.scalar(select(User).where(User.email == settings.bootstrap_admin_email))
        if admin is None:
            db.add(
                User(
                    email=settings.bootstrap_admin_email,
                    full_name="Platform Admin",
                    password_hash=hash_password(settings.bootstrap_admin_password),
                    role=Role.ADMIN,
                )
            )
            print(f"  + {settings.bootstrap_admin_email} (ADMIN)")
        db.commit()

        stores_by_code = {s.code: s for s in db.scalars(select(Store)).all()}
        for row in OPERATORS:
            user = db.scalar(select(User).where(User.email == row["email"]))
            store = stores_by_code[row["store"]]
            if user is None:
                db.add(
                    User(
                        email=row["email"],
                        full_name=row["full_name"],
                        password_hash=hash_password(OPERATOR_PASSWORD),
                        role=Role.OPERATOR,
                        store_id=store.id,
                    )
                )
                print(f"  + {row['email']} -> {store.code}")
            else:
                user.store_id = store.id
        db.commit()
    finally:
        db.close()

    sample_path = settings.inbox_dir / "sample_orders.csv"
    sample_path.write_text(SAMPLE_CSV, encoding="utf-8")
    print(f"\nSample CSV written to {sample_path}")
    print("\nLogins:")
    print(f"  ADMIN     {settings.bootstrap_admin_email} / {settings.bootstrap_admin_password}")
    for row in OPERATORS:
        print(f"  OPERATOR  {row['email']} / {OPERATOR_PASSWORD}  ({row['store']})")


if __name__ == "__main__":
    main()
