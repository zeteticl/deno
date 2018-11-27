// Copyright 2018 the Deno authors. All rights reserved. MIT license.
import * as ts from "typescript";
import { MediaType } from "gen/msg_generated";

import { assetSourceCode } from "./assets";
import { exit as osExit } from "./os";
import { assert, log } from "./util";

const EOL = "\n";
const ASSETS = "$asset$";
const LIB_RUNTIME = "lib.deno_runtime.d.ts";

/** The location that a module is being loaded from. This could be a directory,
 * like `.`, or it could be a module specifier like
 * `http://gist.github.com/somefile.ts`
 */
type ContainingFile = string;
/** The internal local filename of a compiled module. It will often be something
 * like `/home/ry/.deno/gen/f7b4605dfbc4d3bb356e98fda6ceb1481e4a8df5.js`
 */
type Filename = string;
/** The external name of a module - could be a URL or could be a relative path.
 * Examples `http://gist.github.com/somefile.ts` or `./somefile.ts`
 */
type ModuleSpecifier = string;
/** The compiled source code which is cached in `.deno/gen/` */
type OutputCode = string;
/** The original source code */
type SourceCode = string;
/** The output source map */
type SourceMap = string;

export interface CodeProvider {
  getFilename(
    moduleSpecifier: ModuleSpecifier,
    containingFile: ContainingFile
  ): Filename;
  getSource(
    filename: Filename
  ): { sourceCode: SourceCode; mediaType: MediaType };
}

interface CompileResponse {
  outputCode: OutputCode;
  sourceMap: SourceMap;
}

/** Abstraction of the APIs required from the `typescript` module so they can
 * be easily mocked.
 * @internal
 */
export interface Ts {
  createLanguageService: typeof ts.createLanguageService;
  /* tslint:disable-next-line:max-line-length */
  formatDiagnosticsWithColorAndContext: typeof ts.formatDiagnosticsWithColorAndContext;
}

/** A simple object structure for caching resolved modules and their contents.
 *
 * Named `ModuleMetaData` to clarify it is just a representation of meta data of
 * the module, not the actual module instance.
 */
export class ModuleMetaData implements ts.IScriptSnapshot {
  public scriptVersion = "";

  constructor(
    public readonly filename: Filename,
    public readonly mediaType: MediaType,
    public readonly sourceCode: SourceCode
  ) {
    if (filename.endsWith(".d.ts")) {
      this.scriptVersion = "1";
    }
  }

  public getText(start: number, end: number): string {
    return this.sourceCode.substring(start, end);
  }

  public getLength(): number {
    return this.sourceCode.length;
  }

  public getChangeRange(): undefined {
    // Required `IScriptSnapshot` API, but not implemented/needed in deno
    return undefined;
  }
}

function getExtension(
  fileName: Filename,
  mediaType: MediaType
): ts.Extension | undefined {
  switch (mediaType) {
    case MediaType.JavaScript:
      return ts.Extension.Js;
    case MediaType.TypeScript:
      return fileName.endsWith(".d.ts") ? ts.Extension.Dts : ts.Extension.Ts;
    case MediaType.Json:
      return ts.Extension.Json;
    case MediaType.Unknown:
    default:
      return undefined;
  }
}

/** Generate output code for a provided JSON string along with its source. */
export function jsonAmdTemplate(
  jsonString: string,
  sourceFileName: string
): OutputCode {
  // tslint:disable-next-line:max-line-length
  return `define([], function() { return JSON.parse(\`${jsonString}\`); });\n//# sourceURL=${sourceFileName}`;
}

/** A singleton class that combines the TypeScript Language Service host API
 * with Deno specific APIs to provide an interface for compiling and running
 * TypeScript and JavaScript modules.
 */
export class Compiler
  implements ts.LanguageServiceHost, ts.FormatDiagnosticsHost {
  private _exit: typeof osExit = osExit;
  // Modules are usually referenced by their ModuleSpecifier and ContainingFile,
  // and keeping a map of the resolved module file name allows more efficient
  // future resolution
  private readonly _fileNamesMap = new Map<
    ContainingFile,
    Map<ModuleSpecifier, Filename>
  >();
  // A reference to the log utility, so it can be monkey patched during testing
  private _log = log;
  // A map of module file names to module meta data
  private readonly _moduleMetaDataMap = new Map<Filename, ModuleMetaData>();
  // TODO ideally this are not static and can be influenced by command line
  // arguments
  private readonly _options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    module: ts.ModuleKind.AMD,
    outDir: "$deno$",
    resolveJsonModule: true,
    sourceMap: true,
    stripComments: true,
    target: ts.ScriptTarget.ESNext
  };
  private _provider: CodeProvider;
  // Used to contain the script file we are currently compiling
  private _scriptFileNames: string[] = [];
  // A reference to the TypeScript LanguageService instance so it can be
  // monkey patched during testing
  private _service: ts.LanguageService;
  // A reference to `typescript` module so it can be monkey patched during
  // testing
  private _ts: Ts = ts;

  /** The TypeScript language service often refers to the resolved fileName of
   * a module, this is a shortcut to avoid unnecessary module resolution logic
   * for modules that may have been initially resolved by a `moduleSpecifier`
   * and `containingFile`.  Also, `resolveModule()` throws when the module
   * cannot be resolved, which isn't always valid when dealing with the
   * TypeScript compiler, but the TypeScript compiler shouldn't be asking about
   * external modules that we haven't told it about yet.
   */
  private _getModuleMetaData(filename: Filename): ModuleMetaData | undefined {
    return this._moduleMetaDataMap.has(filename)
      ? this._moduleMetaDataMap.get(filename)
      : filename.startsWith(ASSETS)
        ? this._resolveModule(filename, "")
        : undefined;
  }

  /** Given a `moduleSpecifier` and `containingFile` retrieve the cached
   * `fileName` for a given module.  If the module has yet to be resolved
   * this will return `undefined`.
   */
  private _resolveFilename(
    moduleSpecifier: ModuleSpecifier,
    containingFile: ContainingFile
  ): Filename | undefined {
    this._log("compiler._resolveFilename", { moduleSpecifier, containingFile });
    const innerMap = this._fileNamesMap.get(containingFile);
    if (innerMap) {
      return innerMap.get(moduleSpecifier);
    }
    return undefined;
  }

  /** Given a `moduleSpecifier` and `containingFile`, resolve the module and
   * return the `ModuleMetaData`.
   */
  private _resolveModule(
    moduleSpecifier: ModuleSpecifier,
    containingFile: ContainingFile
  ): ModuleMetaData {
    this._log("compiler.resolveModule", { moduleSpecifier, containingFile });
    assert(moduleSpecifier != null && moduleSpecifier.length > 0);
    let filename = this._resolveFilename(moduleSpecifier, containingFile);
    if (filename && this._moduleMetaDataMap.has(filename)) {
      return this._moduleMetaDataMap.get(filename)!;
    }
    let mediaType = MediaType.Unknown;
    let sourceCode: SourceCode | undefined;
    if (
      moduleSpecifier.startsWith(ASSETS) ||
      containingFile.startsWith(ASSETS)
    ) {
      // Assets are compiled into the runtime javascript bundle.
      // we _know_ `.pop()` will return a string, but TypeScript doesn't so
      // not null assertion
      filename = moduleSpecifier.split("/").pop()!;
      const assetName = filename.includes(".") ? filename : `${filename}.d.ts`;
      assert(assetName in assetSourceCode, `No such asset "${assetName}"`);
      mediaType = MediaType.TypeScript;
      sourceCode = assetSourceCode[assetName];
      filename = `${ASSETS}/${assetName}`;
    } else {
      // We query the privileged side via the provider to resolve the filename
      // and then get the source code and media type.
      filename = this._provider.getFilename(moduleSpecifier, containingFile);
      const response = this._provider.getSource(filename);
      mediaType = response.mediaType;
      sourceCode = response.sourceCode;
    }
    assert(filename != null, "No file name.");
    assert(sourceCode ? sourceCode.length > 0 : false, "No source code.");
    assert(
      mediaType !== MediaType.Unknown,
      `Unknown media type for: "${moduleSpecifier}" from "${containingFile}".`
    );
    this._log(
      "resolveModule sourceCode length:",
      sourceCode && sourceCode.length
    );
    this._log("resolveModule has media type:", MediaType[mediaType]);
    // fileName is asserted above, but TypeScript does not track so not null
    this._setFileName(moduleSpecifier, containingFile, filename!);
    if (filename && this._moduleMetaDataMap.has(filename)) {
      return this._moduleMetaDataMap.get(filename)!;
    }
    const moduleMetaData = new ModuleMetaData(
      filename!,
      mediaType,
      sourceCode!
    );
    this._moduleMetaDataMap.set(filename!, moduleMetaData);
    return moduleMetaData;
  }

  /** Caches the resolved `fileName` in relationship to the `moduleSpecifier`
   * and `containingFile` in order to reduce calls to the privileged side
   * to retrieve the contents of a module.
   */
  private _setFileName(
    moduleSpecifier: ModuleSpecifier,
    containingFile: ContainingFile,
    fileName: Filename
  ): void {
    this._log("compiler.setFileName", { moduleSpecifier, containingFile });
    let innerMap = this._fileNamesMap.get(containingFile);
    if (!innerMap) {
      innerMap = new Map();
      this._fileNamesMap.set(containingFile, innerMap);
    }
    innerMap.set(moduleSpecifier, fileName);
  }

  constructor(provider: CodeProvider) {
    this._provider = provider;
    this._service = this._ts.createLanguageService(this);
  }

  // Deno specific compiler API

  /** Retrieve the output of the TypeScript compiler for a given module and
   * cache the result. Re-compilation can be forced using '--recompile' flag.
   */
  compile(filename: Filename): CompileResponse {
    this._log("compiler.compile", filename);
    let moduleMetaData = this._getModuleMetaData(filename);
    if (!moduleMetaData) {
      const { sourceCode, mediaType } = this._provider.getSource(filename);
      moduleMetaData = new ModuleMetaData(filename, mediaType, sourceCode);
      this._moduleMetaDataMap.set(filename, moduleMetaData);
    }
    const { sourceCode, mediaType } = moduleMetaData;
    console.warn("Compiling", filename);
    let outputCode = "";
    let sourceMap = "";
    // Instead of using TypeScript to transpile JSON modules, we will just do
    // it directly.
    if (mediaType === MediaType.Json) {
      outputCode = jsonAmdTemplate(sourceCode, filename);
    } else {
      const service = this._service;
      assert(
        mediaType === MediaType.TypeScript || mediaType === MediaType.JavaScript
      );
      const output = service.getEmitOutput(filename);

      // Get the relevant diagnostics - this is 3x faster than
      // `getPreEmitDiagnostics`.
      const diagnostics = [
        // TypeScript is overly opinionated that only CommonJS modules kinds can
        // support JSON imports.  Allegedly this was fixed in
        // Microsoft/TypeScript#26825 but that doesn't seem to be working here,
        // so we will ignore complaints about this compiler setting.
        ...service
          .getCompilerOptionsDiagnostics()
          .filter(diagnostic => diagnostic.code !== 5070),
        ...service.getSyntacticDiagnostics(filename),
        ...service.getSemanticDiagnostics(filename)
      ];
      if (diagnostics.length > 0) {
        const errMsg = this._ts.formatDiagnosticsWithColorAndContext(
          diagnostics,
          this
        );
        console.log(errMsg);
        // All TypeScript errors are terminal for Deno
        this._exit(1);
      }

      assert(
        !output.emitSkipped,
        "The emit was skipped for an unknown reason."
      );

      assert(
        output.outputFiles.length === 2,
        `Expected 2 files to be emitted, got ${output.outputFiles.length}.`
      );

      const [sourceMapFile, outputFile] = output.outputFiles;
      assert(
        sourceMapFile.name.endsWith(".map"),
        "Expected first emitted file to be a source map"
      );
      assert(
        outputFile.name.endsWith(".js"),
        "Expected second emitted file to be JavaScript"
      );
      outputCode = `${outputFile.text}\n//# sourceURL=${filename}`;
      sourceMap = JSON.parse(sourceMapFile.text);
    }

    moduleMetaData.scriptVersion = "1";
    return { outputCode, sourceMap };
  }

  // TypeScript Language Service and Format Diagnostic Host API

  getCanonicalFileName(fileName: string): string {
    this._log("getCanonicalFileName", fileName);
    return fileName;
  }

  getCompilationSettings(): ts.CompilerOptions {
    this._log("getCompilationSettings()");
    return this._options;
  }

  getNewLine(): string {
    return EOL;
  }

  getScriptFileNames(): string[] {
    // This is equal to `"files"` in the `tsconfig.json`, therefore we only need
    // to include the actual base source files we are evaluating at the moment,
    // which would be what is set during the `.run()`
    return this._scriptFileNames;
  }

  getScriptKind(filename: Filename): ts.ScriptKind {
    this._log("getScriptKind()", filename);
    const moduleMetaData = this._getModuleMetaData(filename);
    if (moduleMetaData) {
      switch (moduleMetaData.mediaType) {
        case MediaType.TypeScript:
          return ts.ScriptKind.TS;
        case MediaType.JavaScript:
          return ts.ScriptKind.JS;
        case MediaType.Json:
          return ts.ScriptKind.JSON;
        default:
          return this._options.allowJs ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      }
    } else {
      return this._options.allowJs ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    }
  }

  getScriptVersion(filename: Filename): string {
    this._log("getScriptVersion()", filename);
    const moduleMetaData = this._getModuleMetaData(filename);
    return (moduleMetaData && moduleMetaData.scriptVersion) || "";
  }

  getScriptSnapshot(filename: Filename): ts.IScriptSnapshot | undefined {
    this._log("getScriptSnapshot()", filename);
    return this._getModuleMetaData(filename);
  }

  getCurrentDirectory(): string {
    this._log("getCurrentDirectory()");
    return "";
  }

  getDefaultLibFileName(): string {
    this._log("getDefaultLibFileName()");
    const moduleSpecifier = LIB_RUNTIME;
    const moduleMetaData = this._resolveModule(moduleSpecifier, ASSETS);
    return moduleMetaData.filename;
  }

  useCaseSensitiveFileNames(): boolean {
    this._log("useCaseSensitiveFileNames()");
    return true;
  }

  readFile(path: string): string | undefined {
    this._log("readFile()", path);
    const moduleMetaData = this._getModuleMetaData(path);
    return moduleMetaData && moduleMetaData.sourceCode;
  }

  fileExists(filename: Filename): boolean {
    const moduleMetaData = this._getModuleMetaData(filename);
    const exists = moduleMetaData != null;
    this._log("fileExists()", filename, exists);
    return exists;
  }

  resolveModuleNames(
    moduleNames: ModuleSpecifier[],
    containingFile: ContainingFile
  ): Array<ts.ResolvedModuleFull | ts.ResolvedModule> {
    this._log("resolveModuleNames()", { moduleNames, containingFile });
    return moduleNames.map(name => {
      let moduleMetaData: ModuleMetaData;
      if (name === "deno") {
        // builtin modules are part of the runtime lib
        moduleMetaData = this._resolveModule(LIB_RUNTIME, ASSETS);
      } else if (name === "typescript") {
        moduleMetaData = this._resolveModule("typescript.d.ts", ASSETS);
      } else {
        moduleMetaData = this._resolveModule(name, containingFile);
      }
      // According to the interface we shouldn't return `undefined` but if we
      // fail to return the same length of modules to those we cannot resolve
      // then TypeScript fails on an assertion that the lengths can't be
      // different, so we have to return an "empty" resolved module
      // TODO: all this does is push the problem downstream, and TypeScript
      // will complain it can't identify the type of the file and throw
      // a runtime exception, so we need to handle missing modules better
      const resolvedFileName = moduleMetaData.filename || "";
      // This flags to the compiler to not go looking to transpile functional
      // code, anything that is in `/$asset$/` is just library code
      const isExternalLibraryImport = resolvedFileName.startsWith(ASSETS);
      return {
        resolvedFileName,
        isExternalLibraryImport,
        extension: getExtension(resolvedFileName, moduleMetaData.mediaType)
      };
    });
  }
}
