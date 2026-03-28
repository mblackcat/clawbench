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
    log "Restarting service..."
    # 'restart' kills and restarts, 'reload' is zero-downtime
    # We use reload for better availability if running in cluster mode
    if $PM2_CMD describe "$APP_NAME" > /dev/null 2>&1; then
        $PM2_CMD reload ecosystem.config.js --env production
    else
        start
    fi
    log "Service restarted."
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
        restart
        ;;
    -stop)
        stop
        ;;
    -status)
        status
        ;;
    *)
        echo "Usage: $0 {-init|-dev|-start|-restart|-stop|-status}"
        echo "  -init    : Install dependencies and setup .env"
        echo "  -dev     : Start local debug server (npm run dev)"
        echo "  -start   : Build and start production server (PM2 Cluster Mode)"
        echo "  -restart : Reload production server (Zero Downtime)"
        echo "  -stop    : Stop production server"
        echo "  -status  : Check PM2 status"
        exit 1
        ;;
esac
