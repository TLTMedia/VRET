# Using Web Browsing Tools in Qwen

This document explains how to use the web browsing tools available in Qwen and how to properly interact with web pages during a conversation.

## Available Web Browsing Tools

### Basic Navigation
- `new_page(url)`: Creates a new browser page and navigates to the specified URL
- `navigate_page()`: Navigates the current page to a new URL or back/forward in history
- `select_page(pageIdx)`: Switches between open pages
- `close_page(pageIdx)`: Closes a specific page
- `list_pages()`: Lists all open pages

### Page Interaction
- `take_snapshot()`: Captures the current page as an accessibility tree with unique element IDs
- `take_screenshot(filePath)`: Takes a visual screenshot of the page
- `click(uid)`: Clicks on an element identified by its unique ID
- `fill(uid, value)`: Fills an input field with a value
- `fill_form(elements)`: Fills multiple form elements at once
- `hover(uid)`: Hovers over an element
- `press_key(key)`: Presses a keyboard key or combination

### Data Extraction
- `evaluate_script(function)`: Runs JavaScript on the page and returns the result
- `list_console_messages()`: Lists console messages from the page
- `get_console_message(msgid)`: Gets a specific console message
- `list_network_requests()`: Lists network requests made by the page
- `get_network_request(reqid)`: Gets details about a specific network request

### Advanced Features
- `wait_for(text)`: Waits for specific text to appear on the page
- `resize_page(width, height)`: Resizes the browser window
- `emulate()`: Emulates different conditions like network throttling or geolocation
- `drag(from_uid, to_uid)`: Drags an element to another element
- `handle_dialog(action)`: Handles browser dialogs (alerts, confirmations, etc.)

## How to Use Web Browsing Tools Effectively

### 1. Starting a Browsing Session
Before you can interact with web pages, you need to create a page:

```
new_page(url="https://www.example.com")
```

### 2. Examining Page Content
Use `take_snapshot()` to get an accessibility tree of the page with unique IDs for each element:

```
take_snapshot()
```

This will return a structured representation of the page with unique UIDs for each interactive element.

### 3. Interacting with Elements
To interact with elements on the page, use the UIDs from the snapshot:

```
click(uid="123")
fill(uid="456", value="some text")
```

### 4. Waiting for Dynamic Content
Some pages load content dynamically. Use `wait_for()` to ensure content is present before interacting:

```
wait_for(text="Expected text on page")
```

### 5. Handling Multiple Pages
You can work with multiple pages simultaneously:

```
page1 = new_page(url="https://site1.com")
page2 = new_page(url="https://site2.com")
select_page(pageIdx=0)  # Switch to the first page
```

## Important Notes

1. **Chrome Remote Debugging Required**: These tools require a Chrome instance running with remote debugging enabled. Start Chrome with:
   ```
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```

2. **Element UIDs Change**: Element UIDs are only valid for the current page state. If the page changes significantly (e.g., navigation, dynamic updates), you need to take a new snapshot to get updated UIDs.

3. **Page Selection**: When you have multiple pages open, make sure to select the correct page before performing actions.

4. **Security Considerations**: Be careful when browsing to sites that require sensitive information. The browsing session is part of the conversation context.

## Common Workflows

### Research Task
1. Create a new page: `new_page(url="https://search-engine.com")`
2. Fill search box: `fill(uid="search-box-uid", value="research topic")`
3. Click search button: `click(uid="search-button-uid")`
4. Examine results: `take_snapshot()`
5. Navigate to relevant result: `click(uid="result-link-uid")`

### Form Submission
1. Navigate to form page: `new_page(url="https://example.com/form")`
2. Fill form fields: `fill(uid="field1-uid", value="data1")`
3. Submit form: `click(uid="submit-button-uid")`
4. Verify submission: `take_snapshot()`

### Data Extraction
1. Navigate to target page: `new_page(url="https://example.com/data")`
2. Extract data with JavaScript: `evaluate_script(function="() => document.querySelector('selector').textContent")`
3. Optionally take a screenshot for reference: `take_screenshot(filePath="/path/to/screenshot.png")`

## Troubleshooting

- If tools aren't working, verify Chrome is running with remote debugging enabled
- If element clicks don't work, retake a snapshot as UIDs may have changed
- If pages aren't loading, check your internet connection and the URL
- For complex interactions, break them down into smaller steps