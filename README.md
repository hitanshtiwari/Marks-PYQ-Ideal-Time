# Marks PYQ Ideal Time

A small Tampermonkey userscript for [Marks](https://getmarks.app/) that shows the **ideal time to solve a PYQ** and compares it with your actual solve time.

I made this because I struggle with time management while doing PYQs. Marks already tells you how long you took, but I wanted a simple benchmark for **how long I should roughly aim to take for that specific question**.

## Features

- Shows the **ideal solve time** provided by Marks for the current question.
- Compares it with your actual solve time.
- Tells you whether you were **faster, slower, or roughly on pace**.
- Uses a small tolerance range so tiny differences aren't treated as a big deal.
- Works with questions you've already solved.
- Keeps the display inside the question area and only shows it after you've solved the question.


The ideal time is simply the value provided by Marks for that question, so treat it as a benchmark rather than an absolute rule.

## Installation

### 1. Install Tampermonkey

Tampermonkey is a browser extension that lets you install and run userscripts.

- [Official Tampermonkey website](https://www.tampermonkey.net/)
- [Tampermonkey: How to install new scripts](https://www.tampermonkey.net/faq.php?q=Q102)

### 2. Install this script

Download/open the `marks-show-ideal-time.js` file from this repository.

Open Tampermonkey, create a new script, and paste the code into the editor. Save the script. Tampermonkey's official guide above explains this in detail.

### 3. Open Marks

Go to [getmarks.app](https://getmarks.app/) and open a PYQ. The panel should appear after the question has been answered.

> **No extra Tampermonkey permissions are required by the script itself** — it uses `@grant none`.

## Notes

This is a userscript built around the current Marks website/API, so it may stop working if Marks changes its frontend or API.

The code is also very much **vibecoded**. I built and tested it with AI assistance rather than writing the whole thing as an experienced JavaScript developer.

So if you actually know JavaScript, browser scripting, or Tampermonkey and notice something that can be improved, please feel free to suggest changes, fork it, or rewrite parts of it.

## Disclaimer

This is an unofficial community-made script and is not affiliated with Marks.

