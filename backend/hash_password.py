# -*- coding: utf-8 -*-
"""
Genera un hash seguro para las passwords del panel.

Uso:
    cd backend
    python hash_password.py "mi_clave_secreta"
    # o:
    python -m hash_password "mi_clave_secreta"

Copia el hash resultante en la variable de entorno DASHBOARD_USERS:

    DASHBOARD_USERS=[{"email":"admin@empresa.com","password_hash":"<el hash impreso>"}]

O en el modo single-user legacy:

    DASHBOARD_LOGIN_EMAIL=admin@empresa.com
    DASHBOARD_PASSWORD_HASH=<el hash impreso>
    (eliminar DASHBOARD_PASSWORD)

El hash usa pbkdf2:sha256 (algoritmo por defecto de werkzeug, parte
de Flask): no requiere dependencias extra.
"""
from __future__ import annotations

import sys

from werkzeug.security import generate_password_hash


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__, file=sys.stderr)
        return 2
    password = sys.argv[1]
    if not password:
        print("Error: password vacía.", file=sys.stderr)
        return 2
    print(generate_password_hash(password))
    return 0


if __name__ == "__main__":
    sys.exit(main())
