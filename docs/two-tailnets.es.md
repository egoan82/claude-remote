# Dos tailnets en una computadora: trabajo + personal

*[Read in English](two-tailnets.md)*

Usa esta guía cuando tu computadora **ya está conectada a la tailnet de otra organización** (por ejemplo, la de tu
empresa) y quieres claude-remote en tu tailnet **personal**, donde está tu celular, sin desconectarte de la primera.

## El problema

- El cliente de Tailscale tiene **un solo perfil activo a la vez**. `tailscale switch` cambia de cuenta, pero no
  mantiene las dos conectadas.
- Con la tailnet del trabajo activa, el celular (en tu tailnet personal) no llega a la computadora y la PWA no carga.
- claude-remote solo necesita que la tailnet personal **entre** a la computadora: `tailscale serve` redirige
  `https://<computadora>.<tailnet>.ts.net` a `127.0.0.1:7681`. La computadora no necesita llegar a otros dispositivos
  personales.

## La solución: un segundo `tailscaled` en modo userspace

```
Celular ──tailnet personal──▶ tailscaled-personal (userspace, socket propio) ──serve──▶ 127.0.0.1:7681
                              tailscaled (sistema, TUN) ──▶ tailnet del trabajo (sin serve)
```

- [`tailscaled-personal.service`](../tailscaled-personal.service) es una unit de sistema que corre
  `tailscaled --tun=userspace-networking` con sus propios:
  - estado en `/var/lib/tailscale-personal`
  - socket en `/run/tailscale-personal/tailscaled.sock`
  - puerto UDP `41642` (el daemon del sistema usa `41641`)
- En modo userspace no crea interfaz de red ni cambia DNS o rutas, así que no choca con el daemon del sistema.
  `tailscale serve` funciona igual porque el propio daemon hace el proxy a localhost.
- [`bin/tsp`](../bin/tsp) es `tailscale` apuntando al socket personal: `tsp status`, `tsp ip -4`,
  `tsp serve status`, etc.
- `make serve`, `make unserve` y `make status` usan el socket personal automáticamente si existe. Si la unit está
  instalada pero el daemon no corre, `make serve` falla en vez de publicar la app en la tailnet del trabajo.

claude-remote no cambia en nada y no se expone nada a internet.

> [!NOTE]
> Revisa la política de tu organización antes de correr un segundo cliente de Tailscale en una computadora de trabajo.

## Antes de empezar

- Linux con systemd y Tailscale instalado (`/usr/sbin/tailscaled`).
- El `tailscaled` del sistema ya tiene sesión en la tailnet del trabajo. `tailscale status` lo muestra.
- Tu tailnet personal tiene **MagicDNS** y **HTTPS Certificates** activos (consola → DNS).
- Tu celular tiene la app de Tailscale con sesión en la tailnet personal.

## Instalación (una vez; pide sudo)

```sh
make install-personal-tailnet   # copia la unit a /etc/systemd/system y la arranca
make personal-up                # abre una URL de login: entra con tu cuenta PERSONAL
make link-ct                    # instala ct y tsp en ~/.local/bin
tsp status                      # la computadora ya aparece en tu tailnet personal
tsp ip -4                       # IP 100.x de la computadora en la tailnet personal
```

`make personal-up` usa `$(hostname)` como nombre del dispositivo y deja a tu usuario como operador, así que después
`tsp` funciona sin sudo. Para otro nombre: `make personal-up TS_HOSTNAME=mi-laptop`.

Después:

1. **Permite los dispositivos personales.** En `claude-remote.service`, pon en `ALLOWED_LOGINS` tu usuario personal
   de Tailscale y en `ALLOWED_IPS` la IP del celular más la de la computadora que da `tsp ip -4` (la del celular sale
   en `tsp status`). Aplícalo con `make install-service`.
2. **Publica la app:** `make serve`. Pasa por el daemon personal.
3. **Revisa los dos daemons:**
   - `tsp serve status` muestra `https://<computadora>.<tailnet-personal>.ts.net`.
   - `tailscale serve status` (sin `tsp`) debe decir `No serve config`. La app no está en la tailnet del trabajo.
4. **Ábrela en el celular:** `https://<computadora>.<tailnet-personal>.ts.net`, e instala la PWA.
5. **Opcional:** actualiza la ACL de tu tailnet personal ([ejemplo](tailscale-acl.hujson)) con la IP o el nombre
   nuevos de la computadora.

> [!WARNING]
> Nunca corras `tailscale serve` a secas (sin `tsp`) para claude-remote: publicaría una terminal de tu computadora
> en la tailnet del trabajo. Usa `make serve` o `tsp serve`.

### Si la computadora ya estaba en tu tailnet personal

Si antes la computadora entraba a la tailnet personal con el daemon del sistema (antes de la del trabajo), el
segundo daemon la registra como un **dispositivo nuevo** con otra IP:

1. En la consola de la tailnet personal, **borra el dispositivo viejo** y, si hace falta, renombra el nuevo con el
   nombre anterior. Así la URL `*.ts.net` desde la que instalaste la PWA no cambia.
2. **Después de renombrar**, corre `tsp serve reset && make serve`. La config de `serve` queda atada al nombre
   anterior; si no la rehaces, el celular recibe `no webserver configured for name/port`.
3. Cambia la IP vieja en `ALLOWED_IPS` y en tu ACL, y luego `make install-service`.

## Limitaciones

- **Desde la computadora no llegas directo a otros dispositivos personales**, porque no hay interfaz TUN. Las
  conexiones entrantes (el celular abriendo la app) sí funcionan. Si algún día necesitas salientes, agrega
  `--socks5-server=localhost:1055` al `ExecStart` de la unit y úsalo como proxy.
- La tailnet del trabajo no se toca: conserva su interfaz TUN, su DNS y sus rutas.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| `make serve` dice `tailscaled-personal no está corriendo` | `sudo systemctl start tailscaled-personal` y revisa `systemctl status tailscaled-personal` |
| `tsp` responde `access denied` | Corre otra vez `make personal-up`; deja a tu usuario como operador |
| El celular muestra `no webserver configured for name/port` | Renombraste el dispositivo después de `serve`: `tsp serve reset && make serve` |
| Error de certificado en el celular | Activa MagicDNS y HTTPS Certificates en la consola de la tailnet **personal** |
| Las peticiones se rechazan (403) | `ALLOWED_IPS` / `ALLOWED_LOGINS` deben tener las IPs y el usuario de la tailnet **personal**; míralos en `tsp status` |

## Desinstalar

```sh
make unserve && make uninstall-personal-tailnet
```

El dispositivo sigue en la tailnet personal hasta que lo borres en la consola. El estado en
`/var/lib/tailscale-personal` queda en disco; bórralo con `sudo rm -rf /var/lib/tailscale-personal` si no vas a volver
a usarlo.

## Alternativas evaluadas

| Opción | Por qué no |
|---|---|
| `tailscale switch` entre cuentas | Pierdes la conexión del trabajo cada vez que cambias |
| Compartir la computadora desde la tailnet del trabajo a tu cuenta personal | Depende del admin y las ACL del trabajo, y deja la app accesible desde la red del trabajo |
| Meter el celular en la tailnet del trabajo | El celular queda con el mismo límite de un perfil, y un dispositivo personal entra a la red del trabajo |
| Túnel público (p. ej. Cloudflare Tunnel + Access) | Un tercero descifra el TLS y ve el tráfico de la terminal; además habría que cambiar la autenticación en `server.js` |
