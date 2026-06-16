#!/bin/bash
# Start Overleaf and open in browser

TOOLKIT_DIR="/home/intern/Documents/overleaf-toolkit"

# Check if the Overleaf app container is already running
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "sharelatex"; then
    xdg-open "http://localhost:80" &
    exit 0
fi

# Start the containers
cd "$TOOLKIT_DIR" || exit 1

notify-send "Overleaf" "Démarrage des conteneurs..." -i "/home/intern/.local/share/icons/overleaf.svg" 2>/dev/null

bin/up -d 2>&1

# Wait for the web service to be ready (max 60 seconds)
for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:80 | grep -qE "200|302"; then
        break
    fi
    sleep 2
done

xdg-open "http://localhost:80" &

notify-send "Overleaf" "Overleaf est prêt!" -i "/home/intern/.local/share/icons/overleaf.svg" 2>/dev/null
