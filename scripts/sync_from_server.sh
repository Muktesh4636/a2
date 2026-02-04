#!/bin/bash
# Sync specific files from server to local (interactive)

SERVER_HOST="${SERVER_HOST:-72.61.254.71}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_DIR="${SERVER_DIR:-/opt/dice_game}"

echo "🔄 Sync Files from Server"
echo "========================="
echo ""

# Common files to sync
FILES=(
    "backend/dice_game/settings.py"
    "backend/dice_game/.env"
    "docker-compose.yml"
    "backend/game/views.py"
    "backend/game/admin_views.py"
)

echo "Available files to sync:"
for i in "${!FILES[@]}"; do
    echo "$((i+1)). ${FILES[$i]}"
done
echo "$((${#FILES[@]}+1)). Sync all common files"
echo "$((${#FILES[@]}+2)). Custom file path"
echo ""

read -p "Select option: " option

if [ "$option" -eq $((${#FILES[@]}+1)) ]; then
    # Sync all
    echo "Syncing all files..."
    for file in "${FILES[@]}"; do
        echo "Copying ${file}..."
        mkdir -p "$(dirname ${file})"
        scp ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/${file} ./${file}.server 2>/dev/null && echo "✅ ${file}" || echo "❌ ${file} (not found)"
    done
elif [ "$option" -eq $((${#FILES[@]}+2)) ]; then
    read -p "Enter server file path (relative to ${SERVER_DIR}): " custom_file
    read -p "Enter local destination: " local_dest
    scp ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/${custom_file} ${local_dest}
    echo "✅ Copied!"
else
    file="${FILES[$((option-1))]}"
    echo "Copying ${file}..."
    mkdir -p "$(dirname ${file})"
    scp ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/${file} ./${file}.server
    echo "✅ Copied to: ./${file}.server"
fi
