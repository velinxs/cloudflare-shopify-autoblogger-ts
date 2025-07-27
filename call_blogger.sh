#!/bin/bash

# A simple script to call the Shopify Autoblogger API.
#
# Usage:
# 1. Make sure you have your API key set as an environment variable:
#    export API_KEY="your_secret_key_here"
# 2. Run the script with the topic as an argument:
#    ./call_blogger.sh "your blog topic here"
#    or
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

# Check if a topic was provided
if [ -z "$1" ]; then
    echo "Error: No topic provided."
    echo "Usage: ./call_blogger.sh --\"your blog topic here\""
    exit 1
fi

TOPIC="$1"

# Remove the leading '--' if it exists, to handle the flag-like input
if [[ "$TOPIC" == --* ]]; then
    TOPIC="${TOPIC:2}"
fi


echo "Generating blog post for topic: \"$TOPIC\"..."

# Make the API call using curl
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
        "blogId": '$BLOG_ID',
        "topic": "'"$TOPIC"'",
        "style": "informative",
        "words": 800,
        "research": "comprehensive",
        "draft": false
      }' \
  --silent | jq . # Pipe to jq for pretty printing if installed

echo -e "\n\nDone."