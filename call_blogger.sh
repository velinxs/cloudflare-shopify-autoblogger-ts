#!/bin/bash

# A simple script to call the Shopify Autoblogger API with CSV keyword support.
#
# Usage:
# 1. Make sure you have your API key set as an environment variable:
#    export API_KEY="your_secret_key_here"
# 2. Run the script with a CSV file containing keywords:
#    ./call_blogger.sh keywords.csv
#    or with a single topic:
#    ./call_blogger.sh --"your blog topic here"

# --- Configuration ---
# The ID of the blog you want to post to.
# You can get this by running: curl -H "Authorization: Bearer $API_KEY" https://api.royalpheromones.com/blogs
BLOG_ID="80784130142"
API_URL="https://api.royalpheromones.com/post"
export API_KEY="KKaUVv1BQOD7MCLRuqUZfezFHqTZlEUZNb9dx59czM0="
# --- Script Logic ---

# Check if API_KEY is set
if [ -z "$API_KEY" ]; then
    echo "Error: API_KEY environment variable is not set."
    echo "Please set it before running the script:"
    echo "export API_KEY=\"your_secret_key_here\""
    exit 1
fi

# Check if input was provided
if [ -z "$1" ]; then
    echo "Error: No input provided."
    echo "Usage: ./call_blogger.sh keywords.csv"
    echo "   or: ./call_blogger.sh --\"your blog topic here\""
    exit 1
fi

# Function to process a single topic
process_topic() {
    local topic="$1"
    local user_prompt="$2"
    
    echo "Generating blog post for topic: \"$topic\"..."
    
    # Build JSON payload
    local json_payload='{
        "blogId": '$BLOG_ID',
        "topic": "'"$topic"'",
        "style": "informative",
        "words": 800,
        "research": "comprehensive",
        "draft": false'
    
    # Add user prompt if provided
    if [ -n "$user_prompt" ]; then
        json_payload+=',
        "userPrompt": "'"$user_prompt"'"'
    fi
    
    json_payload+='}'
    
    # Make the API call using curl
    curl -X POST "$API_URL" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      -d "$json_payload" \
      --silent | jq .
    
    echo -e "\n"
}

INPUT="$1"

# Check if input is a CSV file or a single topic
if [[ "$INPUT" == *.csv ]] && [ -f "$INPUT" ]; then
    echo "Processing CSV file: $INPUT"
    
    # Read CSV file line by line
    while IFS=',' read -r keyword user_prompt || [ -n "$keyword" ]; do
        # Skip empty lines and lines starting with #
        if [[ -z "$keyword" || "$keyword" =~ ^[[:space:]]*# ]]; then
            continue
        fi
        
        # Remove leading/trailing whitespace and quotes
        keyword=$(echo "$keyword" | sed 's/^[[:space:]]*"*//; s/"*[[:space:]]*$//')
        user_prompt=$(echo "$user_prompt" | sed 's/^[[:space:]]*"*//; s/"*[[:space:]]*$//')
        
        if [ -n "$keyword" ]; then
            process_topic "$keyword" "$user_prompt"
            
            # Add a small delay between requests to be nice to the API
            sleep 2
        fi
    done < "$INPUT"
    
elif [[ "$INPUT" == --* ]]; then
    # Handle single topic with -- prefix
    TOPIC="${INPUT:2}"
    process_topic "$TOPIC" ""
else
    # Handle single topic without prefix
    process_topic "$INPUT" ""
fi

echo "Done."