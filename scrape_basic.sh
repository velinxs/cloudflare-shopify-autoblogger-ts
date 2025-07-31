#!/bin/bash

# Basic scraping script
URL="$1"

# Dump the content and remove empty lines
lynx -dump -nolist "$URL" | grep -v "^$"

# If you want to extract specific content, you can pipe to grep
# Example: extract all lines containing "http"
echo "Links found:"
lynx -dump -listonly "$URL" | grep "http"