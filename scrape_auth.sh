#!/bin/bash

# Script to handle authenticated scraping with lynx

URL="$1"
USERNAME="$2"
PASSWORD="$3"
COOKIE_FILE="/tmp/lynx_cookies.txt"

# Clear any existing cookies
rm -f "$COOKIE_FILE"

# Configure lynx options
LYNX_CFG="/tmp/lynx.cfg"
cat > "$LYNX_CFG" << EOF
ACCEPT_ALL_COOKIES:TRUE
COOKIE_FILE:$COOKIE_FILE
COOKIE_SAVE_FILE:$COOKIE_FILE
EOF

# Function to scrape with authentication
scrape_auth() {
    # First visit to get any csrf tokens and set cookies
    lynx -cfg="$LYNX_CFG" \
         -cmd_script <(echo -e "key ^J\nkey $USERNAME\nkey ^J\nkey $PASSWORD\nkey ^J\nkey q\nkey y") \
         -accept_all_cookies \
         -cookie_file="$COOKIE_FILE" \
         -cookie_save_file="$COOKIE_FILE" \
         "$URL"

    # Now dump the authenticated page
    lynx -cfg="$LYNX_CFG" \
         -dump \
         -nolist \
         -cookie_file="$COOKIE_FILE" \
         "$URL"
}

# Main execution
if [ $# -lt 3 ]; then
    echo "Usage: $0 <url> <username> <password>"
    exit 1
fi

scrape_auth

# Clean up
rm -f "$COOKIE_FILE" "$LYNX_CFG"