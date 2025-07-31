#!/usr/bin/env python3
import subprocess
import sys
import re
from typing import List, Dict
import json

def scrape_url(url: str) -> str:
    """Scrape content from URL using lynx"""
    try:
        # -dump: output the rendered page
        # -nolist: don't show the references at the bottom
        # -notitle: don't show the title
        # -width=1000: set wide output to prevent wrapping
        cmd = ['lynx', '-dump', '-nolist', '-notitle', '-width=1000', url]
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.stdout
    except Exception as e:
        print(f"Error scraping {url}: {e}")
        return ""

def extract_data(content: str, patterns: Dict[str, str]) -> Dict[str, List[str]]:
    """Extract data based on regex patterns"""
    results = {}
    for key, pattern in patterns.items():
        matches = re.findall(pattern, content, re.MULTILINE)
        results[key] = matches
    return results

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scrape_advanced.py <url>")
        sys.exit(1)

    url = sys.argv[1]
    
    # Define patterns to extract (customize these for your needs)
    patterns = {
        "emails": r'[\w\.-]+@[\w\.-]+\.\w+',
        "prices": r'\$\d+(?:\.\d{2})?',
        "dates": r'\d{1,2}/\d{1,2}/\d{4}',
        "phones": r'\(\d{3}\)\s*\d{3}-\d{4}'
    }

    # Scrape the content
    content = scrape_url(url)
    
    # Extract data
    data = extract_data(content, patterns)
    
    # Output results as JSON
    print(json.dumps(data, indent=2))

if __name__ == "__main__":
    main()