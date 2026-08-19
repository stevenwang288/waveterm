/* eslint-disable no-console */
// 扫描 TSX 中“用户可见”的未汉化英文文本候选（JSX 文本/特定属性/JSX 表达式字符串）。
// 用法：node "scripts/i18n-scan-visible.cjs"

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const defaultScanRoots = [path.join(repoRoot, "frontend", "app")];

const USER_FACING_ATTR_EXACT = new Set(["title", "placeholder", "alt", "aria-label", "ariaLabel"]);
const USER_FACING_ATTR_SUFFIX = ["Label", "Text", "Message", "Description"];
const IGNORE_TEXT_EXACT = new Set([
    "&gt;",
    "&lt;",
    "&lrm;",
    "(no text content)",
    "AI",
    "Ctrl",
    "Alt",
    "Shift",
    "Cmd",
    "Meta",
    "Esc",
]);
const IGNORE_ATTR_EXACT = new Set([
    "className",
    "id",
    "role",
    "rel",
    "target",
    "type",
    "name",
    "value",
    "href",
    "src",
    "key",
    "ref",
    "tabIndex",
    "data-role",
    "data-testid",
]);

function isUserFacingAttr(attrName) {
    if (!attrName) return false;
    if (IGNORE_ATTR_EXACT.has(attrName)) return false;
    if (USER_FACING_ATTR_EXACT.has(attrName)) return true;
    return USER_FACING_ATTR_SUFFIX.some((s) => attrName.endsWith(s));
}

function normalizeText(s) {
    return String(s ?? "")
        .replace(/\s+/g, " ")
        .replace(/\u00a0/g, " ")
        .trim();
}

function looksLikeEnglishUiText(s) {
    const t = normalizeText(s);
    if (!t) return false;
    if (IGNORE_TEXT_EXACT.has(t)) return false;
    if (/^&[A-Za-z]+;$/.test(t)) return false;
    if (t.length === 1 && /[A-Za-z]/.test(t)) return false;
    // 过滤纯标点/纯数字
    if (!/[A-Za-z]/.test(t)) return false;
    // 过滤 i18n key 或代码片段
    if (t.includes(".") && !t.includes(" ")) return false;
    if (t.startsWith("http://") || t.startsWith("https://")) return false;
    return true;
}

async function listFilesRecursively(dir, predicate) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const results = [];
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === "node_modules" || ent.name === "dist") continue;
            results.push(...(await listFilesRecursively(full, predicate)));
        } else if (ent.isFile()) {
            if (predicate(full)) results.push(full);
        }
    }
    return results;
}

function posToLine(sourceFile, pos) {
    const lc = sourceFile.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, col: lc.character + 1 };
}

function scanTsxFile(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hits = [];

    function addHit(node, kind, rawText) {
        if (!looksLikeEnglishUiText(rawText)) return;
        const { line, col } = posToLine(sourceFile, node.getStart(sourceFile));
        hits.push({
            file: path.relative(repoRoot, filePath).replace(/\\/g, "/"),
            line,
            col,
            kind,
            text: normalizeText(rawText),
        });
    }

    function visit(node) {
        if (ts.isJsxText(node)) {
            addHit(node, "JsxText", node.text);
        }

        if (ts.isJsxExpression(node) && node.expression) {
            // 若 JSX 表达式位于 attribute initializer 中（如 rel={"noopener"}），则交由 JsxAttribute 分支处理，
            // 并对非用户可见属性（rel/className 等）忽略，避免噪音。
            if (ts.isJsxAttribute(node.parent)) {
                ts.forEachChild(node, visit);
                return;
            }
            const expr = node.expression;
            if (ts.isStringLiteralLike(expr)) {
                addHit(expr, "JsxExpressionString", expr.text);
            }
        }

        if (ts.isJsxAttribute(node) && node.initializer) {
            const name = node.name?.getText(sourceFile);
            if (!isUserFacingAttr(name)) {
                // 忽略大部分属性字符串（className/rel 等），避免噪音
            } else if (ts.isStringLiteral(node.initializer)) {
                addHit(node.initializer, `Attr:${name}`, node.initializer.text);
            } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
                const expr = node.initializer.expression;
                if (ts.isStringLiteralLike(expr)) {
                    addHit(expr, `AttrExpr:${name}`, expr.text);
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return hits;
}

async function main() {
    const args = process.argv.slice(2);
    const flags = new Set(args.filter((a) => a.startsWith("-")));
    const roots = args.filter((a) => !a.startsWith("-"));
    const scanRoots = roots.length ? roots.map((r) => path.resolve(process.cwd(), r)) : defaultScanRoots;
    const printAll = flags.has("--all");
    const printJson = flags.has("--json");

    const tsxFiles = [];
    for (const root of scanRoots) {
        if (!fs.existsSync(root)) continue;
        // 只扫 TSX（纯 TS 通常不是 UI 文本）
        const files = await listFilesRecursively(root, (p) => p.endsWith(".tsx"));
        tsxFiles.push(...files);
    }

    const allHits = [];
    for (const f of tsxFiles) {
        allHits.push(...scanTsxFile(f));
    }

    if (printJson) {
        console.log(JSON.stringify(allHits, null, 2));
        return;
    }

    if (printAll) {
        const sorted = [...allHits].sort((a, b) =>
            a.file === b.file ? a.line - b.line || a.col - b.col : a.file.localeCompare(b.file),
        );
        for (const h of sorted) {
            console.log(`${h.file}:${h.line}:${h.col}\t${h.kind}\t${h.text}`);
        }
        return;
    }

    const byText = new Map();
    for (const h of allHits) {
        const key = h.text;
        const arr = byText.get(key) ?? [];
        arr.push(h);
        byText.set(key, arr);
    }

    const top = [...byText.entries()]
        .map(([text, arr]) => ({ text, count: arr.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40);

    console.log(`Scanned TSX files: ${tsxFiles.length}`);
    console.log(`Hits: ${allHits.length} (unique: ${byText.size})`);
    console.log("");
    console.log("Top strings:");
    for (const t of top) {
        console.log(`- (${t.count}) ${t.text}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
