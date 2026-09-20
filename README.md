# AI Dataset Binary Encoder

**EC2201 — Digital Systems Project**

An interactive, fully client-side web app that converts AI dataset values (numeric and categorical) into binary representations, with step-by-step conversion, validation, charts, and export — no backend required.

---

## How to run

No installation, build step, or server is required.

1. Unzip/copy the project folder `ai-dataset-binary-encoder/`.
2. Double-click **`index.html`** to open it in any modern browser (Chrome, Edge, Firefox).
   - Or, for the most reliable experience (some browsers restrict `file://` drag-and-drop), serve it locally:
     ```bash
     cd ai-dataset-binary-encoder
     python3 -m http.server 8000
     ```
     then open `http://localhost:8000` in your browser.
3. The app loads with sample data ready to go — click **Start Encoding** on the Home page, or **Load Sample Dataset** on the Dataset page.

No API keys, no npm install, no database. Everything (CSV parsing, binary conversion, validation, charts, export) runs entirely in your browser.

---

## Project structure

```
ai-dataset-binary-encoder/
├── index.html        # Page structure — Home, Dataset, Encoder, Visualization, Validation, Test Cases, About
├── style.css         # Dark navy/cyan digital-electronics theme, fully responsive
├── script.js         # All application logic: CSV parsing, encoding, validation, charts, export
├── sample-data.csv   # Sample dataset used by the "Load Sample Dataset" button
└── README.md         # This file
```

---

## How to use it

1. **Dataset page** — Upload a CSV by drag-and-drop or file picker, type data manually, or click **Load Sample Dataset**.
2. **Encoder page**:
   - **Step 1 — Configuration:** pick which fields to encode, an encoding scheme, bit length, missing-value handling, and row order.
   - **Step 2 — Try a single value:** type any number or category to see its binary conversion and division steps instantly.
   - **Step 3 — Digital logic visualization:** watch the animated pipeline (Dataset → Preprocessing → Encoding → Binary Encoder → Validation → Binary Dataset) and see the resulting bits lit up as LEDs.
   - **Step 4 — Data table:** search, filter by status, sort, and page through every encoded value.
   - **Step 5 — Export:** download the encoded dataset as CSV or JSON, or reset everything.
3. **Visualization page** — Charts (built with Chart.js) update automatically after each encoding run: records per field, valid vs invalid, bit distribution, and run history.
4. **Validation page** — Live counts of valid records, warnings, and errors, plus a detailed issue log explaining exactly what's wrong with each flagged value.
5. **Test Cases page** — Click **Run All Test Cases** to execute 10 normal conversions (0–31 in binary) and 5 edge/fault cases (missing value, empty input, negative number, non-numeric value, bit-length overflow) live in the browser.
6. **About page** — Explains the problem, solution, benefits, and course context in plain English.

---

## Encoding schemes explained

| Scheme | What it does |
|---|---|
| **Binary Encoding** | Passes through values that are already binary-like (0/1, yes/no, true/false) as a single validated bit. |
| **Numeric to Binary** | Converts a decimal integer to binary via repeated division by 2, padded to the chosen bit length. |
| **Categorical Encoding** | Assigns each unique category a number by order of first appearance, then converts that number to binary (e.g. Male → 0 → `00`, Female → 1 → `01`). |
| **One-Hot Encoding** | Gives every unique category its own bit position, with exactly one bit set to `1`. |

Missing values can be filled with `0`, skipped entirely, or flagged as invalid — configurable per run.

---

## Tech stack

- HTML5, CSS3 (no framework — hand-written responsive grid/flex layout)
- Vanilla JavaScript (ES6+, no build tooling)
- [Chart.js](https://www.chartjs.org/) (loaded via CDN) for the Visualization page

Tested for zero console errors in Chrome and Firefox at desktop, tablet, and mobile widths.
"# ECE" 
