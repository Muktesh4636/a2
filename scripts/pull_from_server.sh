#!/bin/bash
# Pull code from server to local machine

SERVER_HOST="${SERVER_HOST:-72.61.254.71}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_DIR="${SERVER_DIR:-/opt/dice_game}"
LOCAL_DIR="${LOCAL_DIR:-$(pwd)}"

echo "📥 Pulling Code from Server..."
echo "================================"
echo ""
echo "Server: ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}"
echo "Local: ${LOCAL_DIR}"
echo ""

# Method 1: If server has Git, pull latest and sync
echo "Method 1: Checking if server has Git repository..."
echo "--------------------------------------------------"
SERVER_GIT_STATUS=$(ssh ${SERVER_USER}@${SERVER_HOST} "cd ${SERVER_DIR} && git rev-parse --git-dir 2>/dev/null && echo 'yes' || echo 'no'")

if [ "$SERVER_GIT_STATUS" = "yes" ]; then
    echo "✅ Server has Git repository"
    echo ""
    echo "📋 Getting latest commit from server..."
    SERVER_COMMIT=$(ssh ${SERVER_USER}@${SERVER_HOST} "cd ${SERVER_DIR} && git rev-parse HEAD")
    LOCAL_COMMIT=$(cd ${LOCAL_DIR} && git rev-parse HEAD 2>/dev/null || echo "none")
    
    echo "Server commit: ${SERVER_COMMIT}"
    echo "Local commit: ${LOCAL_COMMIT}"
    echo ""
    
    if [ "$SERVER_COMMIT" != "$LOCAL_COMMIT" ]; then
        echo "⚠️  Commits differ - server may have uncommitted changes"
        echo ""
        echo "Options:"
        echo "1. Pull from Git (if server changes are committed):"
        echo "   cd ${LOCAL_DIR} && git pull origin main"
        echo ""
        echo "2. Copy files directly from server:"
        echo "   scp -r ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/backend ${LOCAL_DIR}/backend_from_server"
    else
        echo "✅ Local and server are in sync"
    fi
else
    echo "❌ Server doesn't have Git repository"
    echo ""
    echo "Copying files directly from server..."
fi

echo ""
echo "Method 2: Direct file copy options"
echo "-----------------------------------"
echo ""
echo "Copy entire backend:"
echo "  scp -r ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/backend ${LOCAL_DIR}/backend_from_server"
echo ""
echo "Copy specific file:"
echo "  scp ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/backend/dice_game/settings.py ${LOCAL_DIR}/backend/dice_game/settings.py.server"
echo ""
echo "Copy docker-compose.yml:"
echo "  scp ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/docker-compose.yml ${LOCAL_DIR}/docker-compose.yml.server"
echo ""
echo "Copy entire project (backup):"
echo "  scp -r ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR} ${LOCAL_DIR}/server_backup"
echo ""

# Interactive menu
echo "What would you like to do?"
echo "1) Pull from Git (if server changes are committed)"
echo "2) Copy backend directory from server"
echo "3) Copy specific file from server"
echo "4) Create full backup from server"
echo ""
read -p "Enter choice (1-4) or press Enter to exit: " choice

case $choice in
    1)
        echo "Pulling from Git..."
        cd ${LOCAL_DIR}
        git pull origin main
        echo "✅ Done!"
        ;;
    2)
        echo "Copying backend directory..."
        scp -r ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/backend ${LOCAL_DIR}/backend_from_server
        echo "✅ Backend copied to: ${LOCAL_DIR}/backend_from_server"
        ;;
    3)
        read -p "Enter file path on server (relative to ${SERVER_DIR}): " file_path
        read -p "Enter local destination path: " local_path
        scp ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/${file_path} ${local_path}
        echo "✅ File copied!"
        ;;
    4)
        echo "Creating full backup..."
        BACKUP_DIR="${LOCAL_DIR}/server_backup_$(date +%Y%m%d_%H%M%S)"
        scp -r ${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR} ${BACKUP_DIR}
        echo "✅ Backup created at: ${BACKUP_DIR}"
        ;;
    *)
        echo "Exiting..."
        ;;
esac
