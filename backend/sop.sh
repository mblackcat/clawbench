#!/bin/bash

# Ensure we are running from the script's directory
cd "$(dirname "$0")" || exit 1

# Configuration
APP_NAME="clawbench-backend"
# Use local PM2 from node_modules if global is not available
PM2_CMD="./node_modules/.bin/pm2"

function log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

function init() {
    log "Initializing project..."
    
    # 1. Install dependencies
    if [ ! -d "node_modules" ]; then
        log "Installing npm dependencies..."
        npm install
        if [ $? -ne 0 ]; then
            log "npm install failed."
            exit 1
        fi
    else
        log "node_modules already exists. Skipping install."
    fi

    # 2. Create .env and prompt for config
    if [ ! -f ".env" ]; then
        log "Creating .env file from .env.example..."
        if [ -f ".env.example" ]; then
            cp .env.example .env
        else
            log "Warning: .env.example not found. Creating empty .env."
            touch .env
        fi

        echo "----------------------------------------"
        echo "Please configure the following required environment variables:"
        
        # Interactive prompts for key variables
        read -p "Enter PORT (default: 3001): " INPUT_PORT
        INPUT_PORT=${INPUT_PORT:-3001}
        
        # Update .env
        if grep -q "^PORT=" .env; then
            # Portable sed solution (works on both macOS/BSD and Linux/GNU)
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s/^PORT=.*/PORT=$INPUT_PORT/" .env
            else
                sed -i "s/^PORT=.*/PORT=$INPUT_PORT/" .env
            fi
        else
            echo "PORT=$INPUT_PORT" >> .env
        fi
        
        echo "----------------------------------------"
        log ".env file created."
        log "IMPORTANT: Please review .env and configure other variables (DB_PATH, JWT_SECRET, etc.) manually."
    else
        log ".env file already exists. Skipping creation."
    fi
    
    # Create logs directory for PM2
    if [ ! -d "logs" ]; then
        mkdir -p logs
    fi

    log "Initialization complete."
}

function dev() {
    log "Starting service in DEBUG/DEV mode..."
    npm run dev
}

function start() {
    log "Building project..."
    npm run build
    if [ $? -ne 0 ]; then
        log "Build failed. Aborting start."
        exit 1
    fi

    # Build admin web panel if not already built
    if [ ! -f "admin-panel/dist/index.html" ]; then
        log "Admin panel not built — building now..."
        rebuild_admin
    else
        log "Admin panel dist/ found. Skipping build (use -rebuild to force)."
    fi

    log "Starting service with PM2 (Cluster Mode)..."
    # Use PM2 to start/reload the application
    # If it's already running, reload it for zero-downtime deployment
    if $PM2_CMD describe "$APP_NAME" > /dev/null 2>&1; then
        log "Service is already running. Reloading..."
        $PM2_CMD reload ecosystem.config.js --env production
    else
        $PM2_CMD start ecosystem.config.js --env production
    fi

    if [ $? -eq 0 ]; then
        log "Service started successfully."
        $PM2_CMD save
    else
        log "Failed to start service."
        exit 1
    fi
}

function stop() {
    log "Stopping service..."
    if $PM2_CMD describe "$APP_NAME" > /dev/null 2>&1; then
        $PM2_CMD stop "$APP_NAME"
        log "Service stopped."
    else
        log "Service is not running."
    fi
}

function restart() {
    # $1: pass "-f" to force a full rebuild + hard restart (delete + start).
    # Force mode destroys and recreates workers instead of a rolling reload,
    # guaranteeing every worker runs freshly compiled code (no stale worker reuse).
    local force="$1"

    log "Building project..."
    npm run build
    if [ $? -ne 0 ]; then
        log "Build failed. Aborting restart."
        exit 1
    fi

    # Build admin web panel if not already built
    if [ ! -f "admin-panel/dist/index.html" ]; then
        log "Admin panel not built — building now..."
        rebuild_admin
    else
        log "Admin panel dist/ found. Skipping build (use -rebuild to force)."
    fi

    if [ "$force" == "-f" ]; then
        log "Force restart: recompiled and hard-restarting (delete + start)..."
        if $PM2_CMD describe "$APP_NAME" > /dev/null 2>&1; then
            $PM2_CMD delete "$APP_NAME"
        fi
        $PM2_CMD start ecosystem.config.js --env production
        if [ $? -eq 0 ]; then
            $PM2_CMD save
            log "Service force-restarted."
        else
            log "Failed to force-restart service."
            exit 1
        fi
        return
    fi

    log "Restarting service..."
    # 'restart' kills and restarts, 'reload' is zero-downtime
    # We use reload for better availability if running in cluster mode
    if $PM2_CMD describe "$APP_NAME" > /dev/null 2>&1; then
        $PM2_CMD reload ecosystem.config.js --env production
    else
        $PM2_CMD start ecosystem.config.js --env production
    fi
    log "Service restarted."
}

function rebuild_admin() {
    log "Rebuilding admin panel..."
    local admin_dir="admin-panel"

    if [ ! -d "$admin_dir" ]; then
        log "Error: admin-panel directory not found."
        exit 1
    fi

    cd "$admin_dir" || exit 1

    if [ ! -d "node_modules" ]; then
        log "Installing admin-panel dependencies..."
        npm install
        if [ $? -ne 0 ]; then
            log "admin-panel npm install failed."
            exit 1
        fi
    fi

    log "Building admin-panel (vite)..."
    npm run build
    if [ $? -ne 0 ]; then
        log "admin-panel build failed."
        exit 1
    fi

    cd ..
    log "Admin panel build complete. (dist → admin-panel/dist/)"
}

function status() {
    $PM2_CMD status
    # Also show logs tail
    # $PM2_CMD logs "$APP_NAME" --lines 10 --nostream
}

# Main command dispatcher
case "$1" in
    -init)
        init
        ;;
    -dev)
        dev
        ;;
    -start)
        start
        ;;
    -restart)
        restart "$2"
        ;;
    -stop)
        stop
        ;;
    -status)
        status
        ;;
    -rebuild)
        rebuild_admin
        ;;
    *)
        echo "Usage: $0 {-init|-dev|-start|-restart [-f]|-stop|-status|-rebuild}"
        echo "  -init       : Install dependencies and setup .env"
        echo "  -dev        : Start local debug server (npm run dev)"
        echo "  -start      : Build and start production server (PM2 Cluster Mode)"
        echo "  -restart    : Rebuild and reload production server (Zero Downtime)"
        echo "  -restart -f : Rebuild and hard-restart (delete + start; no stale worker reuse)"
        echo "  -stop       : Stop production server"
        echo "  -status     : Check PM2 status"
        echo "  -rebuild    : Rebuild admin web panel (admin-panel/dist/)"
        exit 1
        ;;
esac
