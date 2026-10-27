PORT ?= 7681

.PHONY: install start link-ct install-service uninstall-service serve unserve hooks status

install:            ## dependencias + íconos
	npm ci

start:              ## correr en primer plano
	PORT=$(PORT) node server.js

link-ct:            ## instala el comando `ct` en ~/.local/bin
	mkdir -p $(HOME)/.local/bin && ln -sf $(CURDIR)/bin/ct $(HOME)/.local/bin/ct

install-service:    ## arranca solo al iniciar sesión (systemd de usuario)
	mkdir -p $(HOME)/.config/systemd/user
	cp claude-remote.service $(HOME)/.config/systemd/user/
	systemctl --user daemon-reload && systemctl --user enable --now claude-remote

uninstall-service:
	systemctl --user disable --now claude-remote; rm -f $(HOME)/.config/systemd/user/claude-remote.service

serve:              ## publica https://<laptop>.<tailnet>.ts.net solo dentro de tu tailnet
	tailscale serve --bg --https=443 http://127.0.0.1:$(PORT)

unserve:
	tailscale serve --https=443 off

hooks:              ## avisos push: make hooks DIRS="~/.claude ~/.claude-work"
	node scripts/install-hooks.js $(DIRS)

status:
	systemctl --user status claude-remote --no-pager; tailscale serve status
