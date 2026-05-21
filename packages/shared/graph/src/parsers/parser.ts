import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { detectLanguage } from "../language.js";
import type {
  EdgeKind,
  GraphEdgeInput,
  GraphNodeInput,
  NodeKind,
  ParsedFileGraph,
  SupportedLanguage,
} from "../types.js";

type TreeSitterModule = {
  Parser: {
    init(options?: { locateFile: (file: string, folder: string) => string }): Promise<void>;
    new(): TreeSitterParser;
  };
  Language: {
    load(input: string | Uint8Array): Promise<TreeSitterLanguage>;
  };
};

type TreeSitterLanguage = unknown;

type TreeSitterParser = {
  setLanguage(language: TreeSitterLanguage | null): TreeSitterParser;
  parse(source: string): TreeSitterTree | null;
};

type TreeSitterTree = {
  rootNode: TreeSitterNode;
};

type TreeSitterNode = {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildren: TreeSitterNode[];
  children: TreeSitterNode[];
  namedChild(index: number): TreeSitterNode | null;
  childForFieldName(fieldName: string): TreeSitterNode | null;
  descendantsOfType(types: string | string[]): (TreeSitterNode | null)[];
};

type SourceLine = {
  number: number;
  text: string;
};

const require = createRequire(import.meta.url);

const TREE_SITTER_LANGUAGE_WASM: Partial<Record<SupportedLanguage, string>> = {
  python: "tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  go: "tree-sitter-go.wasm",
  java: "tree-sitter-java.wasm",
};

let treeSitterModulePromise: Promise<TreeSitterModule | null> | null = null;
let treeSitterWasmDir: string | null = null;
const languageCache = new Map<SupportedLanguage, Promise<TreeSitterLanguage | null>>();

const JS_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "node:assert",
  "node:buffer",
  "node:child_process",
  "node:crypto",
  "node:events",
  "node:fs",
  "node:http",
  "node:https",
  "node:path",
  "node:process",
  "node:stream",
  "node:url",
  "node:util",
  "path",
  "process",
  "stream",
  "url",
  "util",
]);

export async function parseSourceFile(filePath: string, source: string): Promise<ParsedFileGraph | null> {
  const language = detectLanguage(filePath);
  if (!language) return null;
  if (language === "vue") {
    return parseVue(filePath, source);
  }
  return parseByLanguage(filePath, source, language);
}

async function parseByLanguage(filePath: string, source: string, language: SupportedLanguage): Promise<ParsedFileGraph> {
  const lines = source.split(/\r?\n/).map<SourceLine>((text, index) => ({
    number: index + 1,
    text,
  }));
  const nodes: GraphNodeInput[] = [fileNode(filePath, language, lines.length)];
  const edges: GraphEdgeInput[] = [];
  const warnings: string[] = [];
  const parsed = await parseWithTreeSitter(filePath, source, language, nodes, edges, warnings);

  if (!parsed) {
    switch (language) {
      case "python":
        parsePython(filePath, language, lines, nodes, edges);
        break;
      case "javascript":
      case "typescript":
        parseJavaScriptLike(filePath, language, lines, nodes, edges);
        break;
      case "go":
        parseGo(filePath, language, lines, nodes, edges);
        break;
      case "java":
        parseJava(filePath, language, lines, nodes, edges);
        break;
      case "sql":
        parseSql(filePath, language, lines, nodes, edges);
        break;
      case "vue":
        break;
    }
  }

  addContainmentEdges(filePath, nodes, edges);
  addTestedByEdges(nodes, edges, filePath);
  dedupeGraph(nodes, edges);
  return { language, nodes, edges, warnings };
}

async function parseVue(filePath: string, source: string): Promise<ParsedFileGraph> {
  const lines = source.split(/\r?\n/);
  const nodes: GraphNodeInput[] = [fileNode(filePath, "vue", lines.length)];
  const edges: GraphEdgeInput[] = [];
  const warnings: string[] = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(source)) !== null) {
    const attrs = match[1] ?? "";
    const script = match[2] ?? "";
    const before = source.slice(0, match.index);
    const lineOffset = before.split(/\r?\n/).length - 1;
    const scriptLanguage: SupportedLanguage = attrs.includes("lang=\"ts\"") || attrs.includes("lang='ts'")
      ? "typescript"
      : "javascript";
    const parsed = await parseByLanguage(filePath, script, scriptLanguage);
    for (const node of parsed.nodes) {
      if (node.kind === "File") continue;
      nodes.push({ ...node, language: "vue", lineStart: node.lineStart + lineOffset, lineEnd: node.lineEnd + lineOffset });
    }
    for (const edge of parsed.edges) {
      edges.push({ ...edge, filePath, line: (edge.line ?? 0) + lineOffset });
    }
    warnings.push(...parsed.warnings);
  }
  addContainmentEdges(filePath, nodes, edges);
  addTestedByEdges(nodes, edges, filePath);
  dedupeGraph(nodes, edges);
  return { language: "vue", nodes, edges, warnings };
}

async function parseWithTreeSitter(
  filePath: string,
  source: string,
  language: SupportedLanguage,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  warnings: string[],
): Promise<boolean> {
  if (language === "sql" || language === "vue") return false;
  const loadedLanguage = await loadTreeSitterLanguage(language);
  const mod = await loadTreeSitterModule();
  if (!loadedLanguage || !mod) return false;

  try {
    const parser = new mod.Parser();
    parser.setLanguage(loadedLanguage);
    const tree = parser.parse(source);
    if (!tree) return false;
    const definitions: Definition[] = [];
    switch (language) {
      case "python":
        parsePythonTree(filePath, language, tree.rootNode, nodes, edges, definitions);
        break;
      case "javascript":
      case "typescript":
        parseJavaScriptTree(filePath, language, tree.rootNode, nodes, edges, definitions);
        break;
      case "go":
        parseGoTree(filePath, language, tree.rootNode, nodes, edges, definitions);
        break;
      case "java":
        parseJavaTree(filePath, language, tree.rootNode, nodes, edges, definitions);
        break;
    }
    parseCallEdgesFromTree(filePath, tree.rootNode, definitions, edges);
    return true;
  } catch (error) {
    warnings.push(`Tree-sitter parsing failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function loadTreeSitterModule(): Promise<TreeSitterModule | null> {
  if (!treeSitterModulePromise) {
    treeSitterModulePromise = (async () => {
      try {
        const entryPath = require.resolve("@vscode/tree-sitter-wasm");
        const packageWasmDir = dirname(entryPath);
        treeSitterWasmDir = resolveTreeSitterWasmDir(packageWasmDir);
        const mod = (await import(entryPath)) as { default?: TreeSitterModule };
        const treeSitter = mod.default;
        if (!treeSitter) return null;
        await treeSitter.Parser.init({
          locateFile: (file) => join(treeSitterWasmDir ?? packageWasmDir, file),
        });
        return treeSitter;
      } catch {
        return null;
      }
    })();
  }
  return treeSitterModulePromise;
}

function resolveTreeSitterWasmDir(packageWasmDir: string): string {
  const requirePath = require.resolve("@vscode/tree-sitter-wasm");
  const cliDistVendor = resolve(dirname(requirePath), "vendor", "tree-sitter-wasm");
  if (requirePath.includes(`${join("packages", "cli", "dist")}${"/"}`)) {
    return cliDistVendor;
  }
  return packageWasmDir;
}

async function loadTreeSitterLanguage(language: SupportedLanguage): Promise<TreeSitterLanguage | null> {
  const wasmName = TREE_SITTER_LANGUAGE_WASM[language];
  if (!wasmName) return null;
  const existing = languageCache.get(language);
  if (existing) return existing;
  const promise = (async () => {
    const mod = await loadTreeSitterModule();
    if (!mod || !treeSitterWasmDir) return null;
    try {
      return await mod.Language.load(join(treeSitterWasmDir, wasmName));
    } catch {
      return null;
    }
  })();
  languageCache.set(language, promise);
  return promise;
}

type Definition = {
  name: string;
  qualifiedName: string;
  line: number;
  endLine: number;
  kind: NodeKind;
};

function parsePythonTree(
  filePath: string,
  language: SupportedLanguage,
  root: TreeSitterNode,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  definitions: Definition[],
): void {
  for (const node of walkTree(root)) {
    if (node.type === "class_definition") {
      const name = node.childForFieldName("name")?.text;
      if (!name) continue;
      pushTreeNode(nodes, definitions, { kind: "Class", name, filePath, language, node });
      for (const base of node.childForFieldName("superclasses")?.descendantsOfType("identifier").filter(isTreeNode) ?? []) {
        pushEdge(edges, "INHERITS", qualified(filePath, name), base.text, filePath, lineNumber(node));
      }
    } else if (node.type === "function_definition") {
      const name = node.childForFieldName("name")?.text;
      if (!name) continue;
      const parent = nearestDefinition(definitions, node, "Class");
      const isTest = isTestFile(filePath) || name.startsWith("test_");
      pushTreeNode(nodes, definitions, {
        kind: isTest ? "Test" : "Function",
        name,
        filePath,
        language,
        node,
        parentName: parent?.name,
        isTest,
      });
    } else if (node.type === "import_statement") {
      for (const target of node.namedChildren.map((child) => child?.text.split(/\s+as\s+/i)[0]).filter(isNonEmptyString)) {
        pushEdge(edges, "IMPORTS_FROM", filePath, target, filePath, lineNumber(node));
      }
    } else if (node.type === "import_from_statement") {
      const target = node.namedChildren[0]?.text;
      if (target) pushEdge(edges, "IMPORTS_FROM", filePath, target, filePath, lineNumber(node));
    }
  }
}

function parseJavaScriptTree(
  filePath: string,
  language: SupportedLanguage,
  root: TreeSitterNode,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  definitions: Definition[],
): void {
  for (const node of walkTree(root)) {
    if (node.type === "class_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (!name) continue;
      pushTreeNode(nodes, definitions, { kind: "Class", name, filePath, language, node });
      const heritageTarget = node.descendantsOfType(["extends_clause"]).filter(isTreeNode)[0]?.namedChildren.at(-1)?.text;
      if (heritageTarget) pushEdge(edges, "INHERITS", qualified(filePath, name), heritageTarget, filePath, lineNumber(node));
    } else if (node.type === "function_declaration" || node.type === "method_definition") {
      const name = node.childForFieldName("name")?.text;
      if (!name) continue;
      const isTest = isTestFile(filePath) || isTestName(name);
      pushTreeNode(nodes, definitions, { kind: isTest ? "Test" : "Function", name, filePath, language, node, isTest });
    } else if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name")?.text;
      const value = node.childForFieldName("value");
      if (name && value?.type === "arrow_function") {
        const isTest = isTestFile(filePath) || isTestName(name);
        pushTreeNode(nodes, definitions, { kind: isTest ? "Test" : "Function", name, filePath, language, node, isTest });
      }
    } else if (node.type === "type_alias_declaration" || node.type === "interface_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (name) pushTreeNode(nodes, definitions, { kind: "Type", name, filePath, language, node });
    } else if (node.type === "import_statement" || node.type === "export_statement") {
      const sourceNode = node.childForFieldName("source");
      const target = sourceNode ? cleanStringLiteral(sourceNode.text) : jsImportTarget(node.text);
      if (target) {
        pushEdge(edges, "IMPORTS_FROM", filePath, target, filePath, lineNumber(node), {
          builtin: JS_BUILTINS.has(target),
          ecosystem: "nodejs",
        });
      }
    } else if (node.type === "call_expression") {
      const functionName = functionTargetName(node.childForFieldName("function"));
      if (functionName === "require") {
        const target = firstStringArgument(node);
        if (target) {
          pushEdge(edges, "IMPORTS_FROM", filePath, target, filePath, lineNumber(node), {
            builtin: JS_BUILTINS.has(target),
            ecosystem: "nodejs",
          });
        }
      } else if (functionName && isTestName(functionName)) {
        pushTreeNode(nodes, definitions, {
          kind: "Test",
          name: testNameFromCall(node, functionName),
          filePath,
          language,
          node,
          isTest: true,
        });
      }
    } else if (node.type === "assignment_expression") {
      const left = node.childForFieldName("left");
      const exportName = nodeExportName(left);
      if (exportName) {
        pushEdge(edges, "REFERENCES", filePath, exportName, filePath, lineNumber(node), { ecosystem: "nodejs" });
      }
    }
  }
}

function parseGoTree(
  filePath: string,
  language: SupportedLanguage,
  root: TreeSitterNode,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  definitions: Definition[],
): void {
  for (const node of walkTree(root)) {
    if (node.type === "import_spec") {
      const path = node.childForFieldName("path")?.text ?? node.namedChildren.find((child) => child?.type.endsWith("string_literal"))?.text;
      const target = path ? cleanStringLiteral(path) : null;
      if (target) pushEdge(edges, "IMPORTS_FROM", filePath, target, filePath, lineNumber(node));
    } else if (node.type === "type_spec") {
      const name = node.childForFieldName("name")?.text;
      if (name) pushTreeNode(nodes, definitions, { kind: "Type", name, filePath, language, node });
    } else if (node.type === "function_declaration" || node.type === "method_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (!name) continue;
      const isTest = isTestFile(filePath) || name.startsWith("Test");
      pushTreeNode(nodes, definitions, { kind: isTest ? "Test" : "Function", name, filePath, language, node, isTest });
    }
  }
}

function parseJavaTree(
  filePath: string,
  language: SupportedLanguage,
  root: TreeSitterNode,
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  definitions: Definition[],
): void {
  for (const node of walkTree(root)) {
    if (node.type === "import_declaration") {
      const target = node.namedChildren[0]?.text?.replace(/\s+/g, "");
      if (target) pushEdge(edges, "IMPORTS_FROM", filePath, target, filePath, lineNumber(node));
    } else if (["class_declaration", "interface_declaration", "enum_declaration"].includes(node.type)) {
      const name = node.childForFieldName("name")?.text;
      if (!name) continue;
      const kind: NodeKind = node.type === "class_declaration" ? "Class" : "Type";
      pushTreeNode(nodes, definitions, { kind, name, filePath, language, node });
      for (const parent of node.childForFieldName("superclass")?.descendantsOfType("type_identifier").filter(isTreeNode) ?? []) {
        pushEdge(edges, "INHERITS", qualified(filePath, name), parent.text, filePath, lineNumber(node));
      }
      for (const impl of node.childForFieldName("interfaces")?.descendantsOfType("type_identifier").filter(isTreeNode) ?? []) {
        pushEdge(edges, "IMPLEMENTS", qualified(filePath, name), impl.text, filePath, lineNumber(node));
      }
    } else if (node.type === "method_declaration" || node.type === "constructor_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (!name) continue;
      const isTest = isTestFile(filePath) || isTestName(name) || node.text.includes("@Test");
      pushTreeNode(nodes, definitions, { kind: isTest ? "Test" : "Function", name, filePath, language, node, isTest });
    }
  }
}

function fileNode(filePath: string, language: SupportedLanguage, lineEnd: number): GraphNodeInput {
  return {
    kind: "File",
    name: basename(filePath),
    qualifiedName: filePath,
    filePath,
    lineStart: 1,
    lineEnd: Math.max(1, lineEnd),
    language,
    isTest: isTestFile(filePath),
  };
}

function qualified(filePath: string, name: string, parentName?: string | null): string {
  return parentName ? `${filePath}::${parentName}.${name}` : `${filePath}::${name}`;
}

function pushNode(
  nodes: GraphNodeInput[],
  params: {
    kind: NodeKind;
    name: string;
    filePath: string;
    language: SupportedLanguage;
    line: number;
    parentName?: string | null;
    isTest?: boolean;
    metadata?: Record<string, unknown>;
  },
): void {
  nodes.push({
    kind: params.kind,
    name: params.name,
    qualifiedName: qualified(params.filePath, params.name, params.parentName),
    filePath: params.filePath,
    lineStart: params.line,
    lineEnd: params.line,
    language: params.language,
    parentName: params.parentName ?? null,
    isTest: params.isTest ?? false,
    metadata: params.metadata,
  });
}

function pushEdge(
  edges: GraphEdgeInput[],
  kind: EdgeKind,
  sourceQualified: string,
  targetQualified: string,
  filePath: string,
  line: number,
  metadata?: Record<string, unknown>,
): void {
  edges.push({
    kind,
    sourceQualified,
    targetQualified,
    filePath,
    line,
    confidence: kind === "CALLS" ? 0.75 : 1,
    confidenceTier: kind === "CALLS" ? "HEURISTIC" : "EXTRACTED",
    metadata,
  });
}

function pushTreeNode(
  nodes: GraphNodeInput[],
  definitions: Definition[],
  params: {
    kind: NodeKind;
    name: string;
    filePath: string;
    language: SupportedLanguage;
    node: TreeSitterNode;
    parentName?: string | null;
    isTest?: boolean;
    metadata?: Record<string, unknown>;
  },
): void {
  const lineStart = lineNumber(params.node);
  const lineEnd = endLineNumber(params.node);
  const qualifiedName = qualified(params.filePath, params.name, params.parentName);
  nodes.push({
    kind: params.kind,
    name: params.name,
    qualifiedName,
    filePath: params.filePath,
    lineStart,
    lineEnd,
    language: params.language,
    parentName: params.parentName ?? null,
    isTest: params.isTest ?? false,
    metadata: {
      parser: "tree-sitter",
      ...params.metadata,
    },
  });
  definitions.push({
    name: params.name,
    qualifiedName,
    line: lineStart,
    endLine: lineEnd,
    kind: params.kind,
  });
}

function parseCallEdgesFromTree(
  filePath: string,
  root: TreeSitterNode,
  definitions: Definition[],
  edges: GraphEdgeInput[],
): void {
  const callNodes = root.descendantsOfType(["call", "call_expression", "method_invocation"]).filter(isTreeNode);
  for (const node of callNodes) {
    const target = functionTargetName(node.childForFieldName("function") ?? node.childForFieldName("name"));
    if (!target || isIgnoredCallName(target)) continue;
    const caller = nearestDefinition(definitions, node);
    if (!caller || caller.name === target) continue;
    pushEdge(edges, "CALLS", caller.qualifiedName, target, filePath, lineNumber(node));
  }
}

function* walkTree(node: TreeSitterNode): Generator<TreeSitterNode> {
  yield node;
  for (const child of node.namedChildren) {
    if (child) yield* walkTree(child);
  }
}

function nearestDefinition(
  definitions: Definition[],
  node: TreeSitterNode,
  kind?: NodeKind,
): Definition | undefined {
  const line = lineNumber(node);
  const candidates = definitions
    .filter((definition) => (!kind || definition.kind === kind) && definition.line <= line && definition.endLine >= line)
    .sort((a, b) => (b.line - a.line) || (a.endLine - b.endLine));
  return candidates[0];
}

function lineNumber(node: TreeSitterNode): number {
  return node.startPosition.row + 1;
}

function endLineNumber(node: TreeSitterNode): number {
  return Math.max(lineNumber(node), node.endPosition.row + 1);
}

function cleanStringLiteral(value: string): string {
  return value.replace(/^['"`]/, "").replace(/['"`;]$/, "");
}

function firstStringArgument(node: TreeSitterNode): string | null {
  const stringNode = node.childForFieldName("arguments")?.descendantsOfType("string").filter(isTreeNode)[0];
  return stringNode ? cleanStringLiteral(stringNode.text) : null;
}

function functionTargetName(node: TreeSitterNode | null | undefined): string | null {
  if (!node) return null;
  if (["identifier", "field_identifier", "property_identifier"].includes(node.type)) return node.text;
  if (["member_expression", "selector_expression"].includes(node.type)) {
    return node.childForFieldName("property")?.text ?? node.childForFieldName("field")?.text ?? node.text;
  }
  if (node.type === "scoped_identifier") return node.text;
  return node.namedChildren.at(-1)?.text ?? null;
}

function nodeExportName(node: TreeSitterNode | null | undefined): string | null {
  if (!node || !["member_expression", "selector_expression"].includes(node.type)) return null;
  const object = node.childForFieldName("object")?.text ?? node.childForFieldName("operand")?.text;
  const property = node.childForFieldName("property")?.text ?? node.childForFieldName("field")?.text;
  if (object === "module" && property === "exports") return "module.exports";
  if (object === "exports" && property) return `exports.${property}`;
  return null;
}

function testNameFromCall(node: TreeSitterNode, functionName: string): string {
  const title = firstStringArgument(node);
  return title ? `${functionName}:${title}` : functionName;
}

function isTreeNode(value: TreeSitterNode | null | undefined): value is TreeSitterNode {
  return value !== null && value !== undefined;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function parsePython(
  filePath: string,
  language: SupportedLanguage,
  lines: SourceLine[],
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): void {
  const definitions: { name: string; qualifiedName: string; line: number; indent: number; kind: NodeKind }[] = [];
  for (const line of lines) {
    const indent = line.text.match(/^(\s*)/)?.[1]?.length ?? 0;
    const classMatch = line.text.match(/^\s*class\s+([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?:/);
    if (classMatch?.[1]) {
      const name = classMatch[1];
      pushNode(nodes, { kind: "Class", name, filePath, language, line: line.number });
      definitions.push({ name, qualifiedName: qualified(filePath, name), line: line.number, indent, kind: "Class" });
      const bases = (classMatch[2] ?? "").split(",").map((base) => base.trim()).filter(Boolean);
      for (const base of bases) pushEdge(edges, "INHERITS", qualified(filePath, name), base, filePath, line.number);
      continue;
    }
    const functionMatch = line.text.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/);
    if (functionMatch?.[1]) {
      const parent = [...definitions].reverse().find((definition) => definition.kind === "Class" && definition.indent < indent);
      const name = functionMatch[1];
      const isTest = isTestFile(filePath) || name.startsWith("test_");
      pushNode(nodes, { kind: isTest ? "Test" : "Function", name, filePath, language, line: line.number, parentName: parent?.name, isTest });
      definitions.push({
        name,
        qualifiedName: qualified(filePath, name, parent?.name),
        line: line.number,
        indent,
        kind: isTest ? "Test" : "Function",
      });
      continue;
    }
    const importMatch = line.text.match(/^\s*(?:from\s+([\w.]+)\s+import\s+(.+)|import\s+(.+))/);
    if (importMatch) {
      const target = importMatch[1] ?? importMatch[3] ?? "";
      if (target) pushEdge(edges, "IMPORTS_FROM", filePath, target.trim(), filePath, line.number);
    }
    addCallEdges(filePath, line, definitions, edges, /\b([A-Za-z_][\w]*)\s*\(/g);
  }
}

function parseJavaScriptLike(
  filePath: string,
  language: SupportedLanguage,
  lines: SourceLine[],
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): void {
  const definitions: { name: string; qualifiedName: string; line: number; kind: NodeKind }[] = [];
  for (const line of lines) {
    const classMatch = line.text.match(/\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?/);
    if (classMatch?.[1]) {
      const name = classMatch[1];
      pushNode(nodes, { kind: "Class", name, filePath, language, line: line.number });
      definitions.push({ name, qualifiedName: qualified(filePath, name), line: line.number, kind: "Class" });
      if (classMatch[2]) pushEdge(edges, "INHERITS", qualified(filePath, name), classMatch[2], filePath, line.number);
    }

    for (const name of typeNames(line.text)) {
      pushNode(nodes, { kind: "Type", name, filePath, language, line: line.number });
      definitions.push({ name, qualifiedName: qualified(filePath, name), line: line.number, kind: "Type" });
    }

    const functionName = jsFunctionName(line.text);
    if (functionName) {
      const isTest = isTestFile(filePath) || isTestName(functionName);
      pushNode(nodes, { kind: isTest ? "Test" : "Function", name: functionName, filePath, language, line: line.number, isTest });
      definitions.push({
        name: functionName,
        qualifiedName: qualified(filePath, functionName),
        line: line.number,
        kind: isTest ? "Test" : "Function",
      });
    }

    const importTarget = jsImportTarget(line.text);
    if (importTarget) {
      pushEdge(edges, "IMPORTS_FROM", filePath, importTarget, filePath, line.number, {
        builtin: JS_BUILTINS.has(importTarget),
      });
    }

    const exportMatch = line.text.match(/\b(?:module\.exports|exports\.([A-Za-z_$][\w$]*))\b/);
    if (exportMatch) {
      pushEdge(edges, "REFERENCES", filePath, exportMatch[1] ?? "module.exports", filePath, line.number, { ecosystem: "nodejs" });
    }

    addCallEdges(filePath, line, definitions, edges, /\b([A-Za-z_$][\w$]*)\s*\(/g);
  }
}

function parseGo(
  filePath: string,
  language: SupportedLanguage,
  lines: SourceLine[],
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): void {
  const definitions: { name: string; qualifiedName: string; line: number; kind: NodeKind }[] = [];
  let inImportBlock = false;
  for (const line of lines) {
    if (line.text.match(/^\s*import\s*\(/)) inImportBlock = true;
    if (inImportBlock) {
      const target = line.text.match(/"([^"]+)"/)?.[1];
      if (target) pushEdge(edges, "IMPORTS_FROM", filePath, target, filePath, line.number);
      if (line.text.includes(")")) inImportBlock = false;
    } else {
      const importMatch = line.text.match(/^\s*import\s+"([^"]+)"/);
      if (importMatch?.[1]) pushEdge(edges, "IMPORTS_FROM", filePath, importMatch[1], filePath, line.number);
    }
    const typeMatch = line.text.match(/^\s*type\s+([A-Za-z_]\w*)\s+/);
    if (typeMatch?.[1]) {
      pushNode(nodes, { kind: "Type", name: typeMatch[1], filePath, language, line: line.number });
      definitions.push({ name: typeMatch[1], qualifiedName: qualified(filePath, typeMatch[1]), line: line.number, kind: "Type" });
    }
    const fnMatch = line.text.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/);
    if (fnMatch?.[1]) {
      const isTest = isTestFile(filePath) || fnMatch[1].startsWith("Test");
      pushNode(nodes, { kind: isTest ? "Test" : "Function", name: fnMatch[1], filePath, language, line: line.number, isTest });
      definitions.push({ name: fnMatch[1], qualifiedName: qualified(filePath, fnMatch[1]), line: line.number, kind: isTest ? "Test" : "Function" });
    }
    addCallEdges(filePath, line, definitions, edges, /\b([A-Za-z_]\w*)\s*\(/g);
  }
}

function parseJava(
  filePath: string,
  language: SupportedLanguage,
  lines: SourceLine[],
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): void {
  const definitions: { name: string; qualifiedName: string; line: number; kind: NodeKind }[] = [];
  let nextMethodIsTest = false;
  for (const line of lines) {
    if (line.text.includes("@Test")) nextMethodIsTest = true;
    const importMatch = line.text.match(/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/);
    if (importMatch?.[1]) pushEdge(edges, "IMPORTS_FROM", filePath, importMatch[1], filePath, line.number);
    const classMatch = line.text.match(/\b(class|interface|enum)\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_][\w.]*))?(?:\s+implements\s+([A-Za-z_][\w.,\s]*))?/);
    if (classMatch?.[2]) {
      const kind: NodeKind = classMatch[1] === "interface" || classMatch[1] === "enum" ? "Type" : "Class";
      pushNode(nodes, { kind, name: classMatch[2], filePath, language, line: line.number });
      definitions.push({ name: classMatch[2], qualifiedName: qualified(filePath, classMatch[2]), line: line.number, kind });
      if (classMatch[3]) pushEdge(edges, "INHERITS", qualified(filePath, classMatch[2]), classMatch[3], filePath, line.number);
      for (const impl of (classMatch[4] ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
        pushEdge(edges, "IMPLEMENTS", qualified(filePath, classMatch[2]), impl, filePath, line.number);
      }
    }
    const methodMatch = line.text.match(/\b(?:public|private|protected|static|final|native|synchronized|\s)+[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/);
    if (methodMatch?.[1]) {
      const isTest = nextMethodIsTest || isTestName(methodMatch[1]);
      pushNode(nodes, { kind: isTest ? "Test" : "Function", name: methodMatch[1], filePath, language, line: line.number, isTest });
      definitions.push({ name: methodMatch[1], qualifiedName: qualified(filePath, methodMatch[1]), line: line.number, kind: isTest ? "Test" : "Function" });
      nextMethodIsTest = false;
    }
    addCallEdges(filePath, line, definitions, edges, /\b([A-Za-z_]\w*)\s*\(/g);
  }
}

function parseSql(
  filePath: string,
  language: SupportedLanguage,
  lines: SourceLine[],
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
): void {
  for (const line of lines) {
    const createMatch = line.text.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW|PROCEDURE|FUNCTION)\s+([`"\w.]+)/i);
    if (createMatch?.[2]) {
      const name = cleanSqlName(createMatch[2]);
      pushNode(nodes, { kind: createMatch[1]?.toUpperCase() === "TABLE" || createMatch[1]?.toUpperCase() === "VIEW" ? "Type" : "Function", name, filePath, language, line: line.number });
    }
    const depPattern = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([`"\w.]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = depPattern.exec(line.text)) !== null) {
      const target = match[1] ? cleanSqlName(match[1]) : "";
      if (target && !isSqlKeyword(target)) pushEdge(edges, "DEPENDS_ON", filePath, target, filePath, line.number);
    }
  }
}

function addContainmentEdges(filePath: string, nodes: GraphNodeInput[], edges: GraphEdgeInput[]): void {
  for (const node of nodes) {
    if (node.kind === "File") continue;
    pushEdge(edges, "CONTAINS", filePath, node.qualifiedName, filePath, node.lineStart);
  }
}

function addTestedByEdges(nodes: GraphNodeInput[], edges: GraphEdgeInput[], filePath: string): void {
  const tests = nodes.filter((node) => node.kind === "Test");
  if (tests.length === 0) return;
  const functions = nodes.filter((node) => node.kind === "Function");
  for (const test of tests) {
    const lower = test.name.toLowerCase();
    const target = functions.find((fn) => lower.includes(fn.name.toLowerCase()));
    if (target) pushEdge(edges, "TESTED_BY", test.qualifiedName, target.qualifiedName, filePath, test.lineStart);
  }
}

function dedupeGraph(nodes: GraphNodeInput[], edges: GraphEdgeInput[]): void {
  const seenNodes = new Set<string>();
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (!node) continue;
    if (seenNodes.has(node.qualifiedName)) {
      nodes.splice(index, 1);
      continue;
    }
    seenNodes.add(node.qualifiedName);
  }

  const seenEdges = new Set<string>();
  for (let index = edges.length - 1; index >= 0; index--) {
    const edge = edges[index];
    if (!edge) continue;
    const key = `${edge.kind}|${edge.sourceQualified}|${edge.targetQualified}|${edge.filePath}|${edge.line ?? 0}`;
    if (seenEdges.has(key)) {
      edges.splice(index, 1);
      continue;
    }
    seenEdges.add(key);
  }
}

function addCallEdges(
  filePath: string,
  line: SourceLine,
  definitions: { name: string; qualifiedName: string; line: number }[],
  edges: GraphEdgeInput[],
  pattern: RegExp,
): void {
  const caller = [...definitions].reverse().find((definition) => definition.line <= line.number);
  if (!caller) return;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line.text)) !== null) {
    const name = match[1] ?? "";
    if (!name || isIgnoredCallName(name) || name === caller.name) continue;
    pushEdge(edges, "CALLS", caller.qualifiedName, name, filePath, line.number);
  }
}

function jsFunctionName(text: string): string | null {
  return (
    text.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/)?.[1] ??
    text.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/)?.[1] ??
    text.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/)?.[1] ??
    null
  );
}

function typeNames(text: string): string[] {
  const names: string[] = [];
  const interfaceName = text.match(/\binterface\s+([A-Za-z_$][\w$]*)/)?.[1];
  const typeName = text.match(/\btype\s+([A-Za-z_$][\w$]*)\s*=/)?.[1];
  if (interfaceName) names.push(interfaceName);
  if (typeName) names.push(typeName);
  return names;
}

function jsImportTarget(text: string): string | null {
  return (
    text.match(/\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/)?.[1] ??
    text.match(/\bexport\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/)?.[1] ??
    text.match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/)?.[1] ??
    null
  );
}

function isTestFile(filePath: string): boolean {
  return /(?:^|[./_-])(test|spec)(?:[./_-]|$)/i.test(filePath) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(filePath);
}

function isTestName(name: string): boolean {
  return /^(test|it|describe|should)/i.test(name);
}

function isIgnoredCallName(name: string): boolean {
  return new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "function",
    "return",
    "typeof",
    "sizeof",
    "new",
    "class",
    "def",
    "print",
    "console",
    "test",
    "it",
    "describe",
  ]).has(name);
}

function cleanSqlName(name: string): string {
  return name.replace(/[`";]/g, "");
}

function isSqlKeyword(value: string): boolean {
  return new Set(["select", "where", "group", "order", "having", "limit", "on", "using"]).has(value.toLowerCase());
}
