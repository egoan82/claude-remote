PORT ?= 7681
# If the personal-tailnet daemon exists (docs/two-tailnets.md), serve/unserve/status use it.
TS_SOCKET ?= $(wildcard /run/tailscale-personal/tailscaled.sock)
TS = tailscale $(if $(TS_SOCKET),--socket=$(TS_SOCKET))
TS_HOSTNAME ?= $(shell hostname)

.PHONY: install start link-ct install-service uninstall-service install-personal-tailnet personal-up uninstall-personal-tailnet serve unserve hooks status

install:            ## dependencias + íconos
	npm ci

start:              ## correr en primer plano
	PORT=$(PORT) node server.js

link-ct:            ## instala el comando `ct` en ~/.local/bin
	mkdir -p $(HOME)/.local/bin && ln -sf $(CURDIR)/bin/ct $(HOME)/.local/bin/ct
	ln -sf $(CURDIR)/bin/tsp $(HOME)/.local/bin/tsp

install-service:    ## arranca solo al iniciar sesión (systemd de usuario)
	mkdir -p $(HOME)/.config/systemd/user
	cp claude-remote.service $(HOME)/.config/systemd/user/
	systemctl --user daemon-reload && systemctl --user enable --now claude-remote

uninstall-service:
	systemctl --user disable --now claude-remote; rm -f $(HOME)/.config/systemd/user/claude-remote.service

install-personal-tailnet: ## 2.º tailscaled (userspace) para la tailnet personal; pide sudo
	sudo install -m 644 tailscaled-personal.service /etc/systemd/system/
	sudo systemctl daemon-reload && sudo systemctl enable --now tailscaled-personal

personal-up:        ## login en la tailnet personal; deja a tu usuario como operador (sin sudo después)
	sudo tailscale --socket=/run/tailscale-personal/tailscaled.sock up --hostname=$(TS_HOSTNAME) --operator=$(USER)

uninstall-personal-tailnet:
	sudo systemctl disable --now tailscaled-personal; sudo rm -f /etc/systemd/system/tailscaled-personal.service

serve:              ## publica https://<laptop>.<tailnet>.ts.net solo dentro de tu tailnet
	@if [ -f /etc/systemd/system/tailscaled-personal.service ] && [ -z "$(TS_SOCKET)" ]; then \
	  echo "tailscaled-personal no está corriendo; no publico en la otra tailnet" >&2; exit 1; fi
	$(TS) serve --bg --https=443 http://127.0.0.1:$(PORT)

unserve:
	$(TS) serve --https=443 off

hooks:              ## avisos push: make hooks DIRS="~/.claude ~/.claude-work"
	node scripts/install-hooks.js $(DIRS)

status:
	systemctl --user status claude-remote --no-pager; $(TS) serve status
