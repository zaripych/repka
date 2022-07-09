#!/usr/bin/env node
// NOTE: This file is bundled up from './src/bin/*' and needs to be committed
import require$$0 from 'node:events';
import require$$1 from 'node:child_process';
import require$$2, { dirname, join, relative } from 'node:path';
import require$$3 from 'node:fs';
import require$$4 from 'node:process';
import require$$0$1 from 'node:tty';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { o as once, l as logger, a as spawnToPromise, t as taskArgsPipe, b as setDefaultArgs, i as includesAnyOf, r as removeInputArgs } from './taskArgsPipe.gen.mjs';
import { m as monorepoRootPath, o as onceAsync } from './monorepoRootPath.gen.mjs';
import { load } from 'js-yaml';
import 'node:assert';
import { performance } from 'node:perf_hooks';
import 'fast-glob';

var commander = { exports: {} };

var argument = {};

var error = {};

class CommanderError$2 extends Error {
  constructor(exitCode, code, message) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.code = code;
    this.exitCode = exitCode;
    this.nestedError = void 0;
  }
}
class InvalidArgumentError$3 extends CommanderError$2 {
  constructor(message) {
    super(1, "commander.invalidArgument", message);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}
error.CommanderError = CommanderError$2;
error.InvalidArgumentError = InvalidArgumentError$3;

const { InvalidArgumentError: InvalidArgumentError$2 } = error;
class Argument$2 {
  constructor(name, description) {
    this.description = description || "";
    this.variadic = false;
    this.parseArg = void 0;
    this.defaultValue = void 0;
    this.defaultValueDescription = void 0;
    this.argChoices = void 0;
    switch (name[0]) {
      case "<":
        this.required = true;
        this._name = name.slice(1, -1);
        break;
      case "[":
        this.required = false;
        this._name = name.slice(1, -1);
        break;
      default:
        this.required = true;
        this._name = name;
        break;
    }
    if (this._name.length > 3 && this._name.slice(-3) === "...") {
      this.variadic = true;
      this._name = this._name.slice(0, -3);
    }
  }
  name() {
    return this._name;
  }
  _concatValue(value, previous) {
    if (previous === this.defaultValue || !Array.isArray(previous)) {
      return [value];
    }
    return previous.concat(value);
  }
  default(value, description) {
    this.defaultValue = value;
    this.defaultValueDescription = description;
    return this;
  }
  argParser(fn) {
    this.parseArg = fn;
    return this;
  }
  choices(values) {
    this.argChoices = values.slice();
    this.parseArg = (arg, previous) => {
      if (!this.argChoices.includes(arg)) {
        throw new InvalidArgumentError$2(`Allowed choices are ${this.argChoices.join(", ")}.`);
      }
      if (this.variadic) {
        return this._concatValue(arg, previous);
      }
      return arg;
    };
    return this;
  }
  argRequired() {
    this.required = true;
    return this;
  }
  argOptional() {
    this.required = false;
    return this;
  }
}
function humanReadableArgName$2(arg) {
  const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
  return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
}
argument.Argument = Argument$2;
argument.humanReadableArgName = humanReadableArgName$2;

var command = {};

var help = {};

const { humanReadableArgName: humanReadableArgName$1 } = argument;
class Help$2 {
  constructor() {
    this.helpWidth = void 0;
    this.sortSubcommands = false;
    this.sortOptions = false;
  }
  visibleCommands(cmd) {
    const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
    if (cmd._hasImplicitHelpCommand()) {
      const [, helpName, helpArgs] = cmd._helpCommandnameAndArgs.match(/([^ ]+) *(.*)/);
      const helpCommand = cmd.createCommand(helpName).helpOption(false);
      helpCommand.description(cmd._helpCommandDescription);
      if (helpArgs)
        helpCommand.arguments(helpArgs);
      visibleCommands.push(helpCommand);
    }
    if (this.sortSubcommands) {
      visibleCommands.sort((a, b) => {
        return a.name().localeCompare(b.name());
      });
    }
    return visibleCommands;
  }
  visibleOptions(cmd) {
    const visibleOptions = cmd.options.filter((option) => !option.hidden);
    const showShortHelpFlag = cmd._hasHelpOption && cmd._helpShortFlag && !cmd._findOption(cmd._helpShortFlag);
    const showLongHelpFlag = cmd._hasHelpOption && !cmd._findOption(cmd._helpLongFlag);
    if (showShortHelpFlag || showLongHelpFlag) {
      let helpOption;
      if (!showShortHelpFlag) {
        helpOption = cmd.createOption(cmd._helpLongFlag, cmd._helpDescription);
      } else if (!showLongHelpFlag) {
        helpOption = cmd.createOption(cmd._helpShortFlag, cmd._helpDescription);
      } else {
        helpOption = cmd.createOption(cmd._helpFlags, cmd._helpDescription);
      }
      visibleOptions.push(helpOption);
    }
    if (this.sortOptions) {
      const getSortKey = (option) => {
        return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
      };
      visibleOptions.sort((a, b) => {
        return getSortKey(a).localeCompare(getSortKey(b));
      });
    }
    return visibleOptions;
  }
  visibleArguments(cmd) {
    if (cmd._argsDescription) {
      cmd._args.forEach((argument) => {
        argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
      });
    }
    if (cmd._args.find((argument) => argument.description)) {
      return cmd._args;
    }
    return [];
  }
  subcommandTerm(cmd) {
    const args = cmd._args.map((arg) => humanReadableArgName$1(arg)).join(" ");
    return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + (args ? " " + args : "");
  }
  optionTerm(option) {
    return option.flags;
  }
  argumentTerm(argument) {
    return argument.name();
  }
  longestSubcommandTermLength(cmd, helper) {
    return helper.visibleCommands(cmd).reduce((max, command) => {
      return Math.max(max, helper.subcommandTerm(command).length);
    }, 0);
  }
  longestOptionTermLength(cmd, helper) {
    return helper.visibleOptions(cmd).reduce((max, option) => {
      return Math.max(max, helper.optionTerm(option).length);
    }, 0);
  }
  longestArgumentTermLength(cmd, helper) {
    return helper.visibleArguments(cmd).reduce((max, argument) => {
      return Math.max(max, helper.argumentTerm(argument).length);
    }, 0);
  }
  commandUsage(cmd) {
    let cmdName = cmd._name;
    if (cmd._aliases[0]) {
      cmdName = cmdName + "|" + cmd._aliases[0];
    }
    let parentCmdNames = "";
    for (let parentCmd = cmd.parent; parentCmd; parentCmd = parentCmd.parent) {
      parentCmdNames = parentCmd.name() + " " + parentCmdNames;
    }
    return parentCmdNames + cmdName + " " + cmd.usage();
  }
  commandDescription(cmd) {
    return cmd.description();
  }
  subcommandDescription(cmd) {
    return cmd.description();
  }
  optionDescription(option) {
    const extraInfo = [];
    if (option.argChoices) {
      extraInfo.push(`choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
    }
    if (option.defaultValue !== void 0) {
      const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
      if (showDefault) {
        extraInfo.push(`default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`);
      }
    }
    if (option.presetArg !== void 0 && option.optional) {
      extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
    }
    if (option.envVar !== void 0) {
      extraInfo.push(`env: ${option.envVar}`);
    }
    if (extraInfo.length > 0) {
      return `${option.description} (${extraInfo.join(", ")})`;
    }
    return option.description;
  }
  argumentDescription(argument) {
    const extraInfo = [];
    if (argument.argChoices) {
      extraInfo.push(`choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
    }
    if (argument.defaultValue !== void 0) {
      extraInfo.push(`default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`);
    }
    if (extraInfo.length > 0) {
      const extraDescripton = `(${extraInfo.join(", ")})`;
      if (argument.description) {
        return `${argument.description} ${extraDescripton}`;
      }
      return extraDescripton;
    }
    return argument.description;
  }
  formatHelp(cmd, helper) {
    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth || 80;
    const itemIndentWidth = 2;
    const itemSeparatorWidth = 2;
    function formatItem(term, description) {
      if (description) {
        const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
        return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth);
      }
      return term;
    }
    function formatList(textArray) {
      return textArray.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));
    }
    let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
    const commandDescription = helper.commandDescription(cmd);
    if (commandDescription.length > 0) {
      output = output.concat([commandDescription, ""]);
    }
    const argumentList = helper.visibleArguments(cmd).map((argument) => {
      return formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument));
    });
    if (argumentList.length > 0) {
      output = output.concat(["Arguments:", formatList(argumentList), ""]);
    }
    const optionList = helper.visibleOptions(cmd).map((option) => {
      return formatItem(helper.optionTerm(option), helper.optionDescription(option));
    });
    if (optionList.length > 0) {
      output = output.concat(["Options:", formatList(optionList), ""]);
    }
    const commandList = helper.visibleCommands(cmd).map((cmd2) => {
      return formatItem(helper.subcommandTerm(cmd2), helper.subcommandDescription(cmd2));
    });
    if (commandList.length > 0) {
      output = output.concat(["Commands:", formatList(commandList), ""]);
    }
    return output.join("\n");
  }
  padWidth(cmd, helper) {
    return Math.max(helper.longestOptionTermLength(cmd, helper), helper.longestSubcommandTermLength(cmd, helper), helper.longestArgumentTermLength(cmd, helper));
  }
  wrap(str, width, indent, minColumnWidth = 40) {
    if (str.match(/[\n]\s+/))
      return str;
    const columnWidth = width - indent;
    if (columnWidth < minColumnWidth)
      return str;
    const leadingStr = str.slice(0, indent);
    const columnText = str.slice(indent);
    const indentString = " ".repeat(indent);
    const regex = new RegExp(".{1," + (columnWidth - 1) + "}([\\s\u200B]|$)|[^\\s\u200B]+?([\\s\u200B]|$)", "g");
    const lines = columnText.match(regex) || [];
    return leadingStr + lines.map((line, i) => {
      if (line.slice(-1) === "\n") {
        line = line.slice(0, line.length - 1);
      }
      return (i > 0 ? indentString : "") + line.trimRight();
    }).join("\n");
  }
}
help.Help = Help$2;

var option = {};

const { InvalidArgumentError: InvalidArgumentError$1 } = error;
class Option$2 {
  constructor(flags, description) {
    this.flags = flags;
    this.description = description || "";
    this.required = flags.includes("<");
    this.optional = flags.includes("[");
    this.variadic = /\w\.\.\.[>\]]$/.test(flags);
    this.mandatory = false;
    const optionFlags = splitOptionFlags$1(flags);
    this.short = optionFlags.shortFlag;
    this.long = optionFlags.longFlag;
    this.negate = false;
    if (this.long) {
      this.negate = this.long.startsWith("--no-");
    }
    this.defaultValue = void 0;
    this.defaultValueDescription = void 0;
    this.presetArg = void 0;
    this.envVar = void 0;
    this.parseArg = void 0;
    this.hidden = false;
    this.argChoices = void 0;
    this.conflictsWith = [];
  }
  default(value, description) {
    this.defaultValue = value;
    this.defaultValueDescription = description;
    return this;
  }
  preset(arg) {
    this.presetArg = arg;
    return this;
  }
  conflicts(names) {
    this.conflictsWith = this.conflictsWith.concat(names);
    return this;
  }
  env(name) {
    this.envVar = name;
    return this;
  }
  argParser(fn) {
    this.parseArg = fn;
    return this;
  }
  makeOptionMandatory(mandatory = true) {
    this.mandatory = !!mandatory;
    return this;
  }
  hideHelp(hide = true) {
    this.hidden = !!hide;
    return this;
  }
  _concatValue(value, previous) {
    if (previous === this.defaultValue || !Array.isArray(previous)) {
      return [value];
    }
    return previous.concat(value);
  }
  choices(values) {
    this.argChoices = values.slice();
    this.parseArg = (arg, previous) => {
      if (!this.argChoices.includes(arg)) {
        throw new InvalidArgumentError$1(`Allowed choices are ${this.argChoices.join(", ")}.`);
      }
      if (this.variadic) {
        return this._concatValue(arg, previous);
      }
      return arg;
    };
    return this;
  }
  name() {
    if (this.long) {
      return this.long.replace(/^--/, "");
    }
    return this.short.replace(/^-/, "");
  }
  attributeName() {
    return camelcase(this.name().replace(/^no-/, ""));
  }
  is(arg) {
    return this.short === arg || this.long === arg;
  }
  isBoolean() {
    return !this.required && !this.optional && !this.negate;
  }
}
function camelcase(str) {
  return str.split("-").reduce((str2, word) => {
    return str2 + word[0].toUpperCase() + word.slice(1);
  });
}
function splitOptionFlags$1(flags) {
  let shortFlag;
  let longFlag;
  const flagParts = flags.split(/[ |,]+/);
  if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
    shortFlag = flagParts.shift();
  longFlag = flagParts.shift();
  if (!shortFlag && /^-[^-]$/.test(longFlag)) {
    shortFlag = longFlag;
    longFlag = void 0;
  }
  return { shortFlag, longFlag };
}
option.Option = Option$2;
option.splitOptionFlags = splitOptionFlags$1;

var suggestSimilar$2 = {};

const maxDistance = 3;
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > maxDistance)
    return Math.max(a.length, b.length);
  const d = [];
  for (let i = 0; i <= a.length; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    d[0][j] = j;
  }
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      let cost = 1;
      if (a[i - 1] === b[j - 1]) {
        cost = 0;
      } else {
        cost = 1;
      }
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}
function suggestSimilar$1(word, candidates) {
  if (!candidates || candidates.length === 0)
    return "";
  candidates = Array.from(new Set(candidates));
  const searchingOptions = word.startsWith("--");
  if (searchingOptions) {
    word = word.slice(2);
    candidates = candidates.map((candidate) => candidate.slice(2));
  }
  let similar = [];
  let bestDistance = maxDistance;
  const minSimilarity = 0.4;
  candidates.forEach((candidate) => {
    if (candidate.length <= 1)
      return;
    const distance = editDistance(word, candidate);
    const length = Math.max(word.length, candidate.length);
    const similarity = (length - distance) / length;
    if (similarity > minSimilarity) {
      if (distance < bestDistance) {
        bestDistance = distance;
        similar = [candidate];
      } else if (distance === bestDistance) {
        similar.push(candidate);
      }
    }
  });
  similar.sort((a, b) => a.localeCompare(b));
  if (searchingOptions) {
    similar = similar.map((candidate) => `--${candidate}`);
  }
  if (similar.length > 1) {
    return `
(Did you mean one of ${similar.join(", ")}?)`;
  }
  if (similar.length === 1) {
    return `
(Did you mean ${similar[0]}?)`;
  }
  return "";
}
suggestSimilar$2.suggestSimilar = suggestSimilar$1;

const EventEmitter = require$$0.EventEmitter;
const childProcess = require$$1;
const path = require$$2;
const fs = require$$3;
const process$1 = require$$4;
const { Argument: Argument$1, humanReadableArgName } = argument;
const { CommanderError: CommanderError$1 } = error;
const { Help: Help$1 } = help;
const { Option: Option$1, splitOptionFlags } = option;
const { suggestSimilar } = suggestSimilar$2;
class Command$1 extends EventEmitter {
  constructor(name) {
    super();
    this.commands = [];
    this.options = [];
    this.parent = null;
    this._allowUnknownOption = false;
    this._allowExcessArguments = true;
    this._args = [];
    this.args = [];
    this.rawArgs = [];
    this.processedArgs = [];
    this._scriptPath = null;
    this._name = name || "";
    this._optionValues = {};
    this._optionValueSources = {};
    this._storeOptionsAsProperties = false;
    this._actionHandler = null;
    this._executableHandler = false;
    this._executableFile = null;
    this._executableDir = null;
    this._defaultCommandName = null;
    this._exitCallback = null;
    this._aliases = [];
    this._combineFlagAndOptionalValue = true;
    this._description = "";
    this._argsDescription = void 0;
    this._enablePositionalOptions = false;
    this._passThroughOptions = false;
    this._lifeCycleHooks = {};
    this._showHelpAfterError = false;
    this._showSuggestionAfterError = true;
    this._outputConfiguration = {
      writeOut: (str) => process$1.stdout.write(str),
      writeErr: (str) => process$1.stderr.write(str),
      getOutHelpWidth: () => process$1.stdout.isTTY ? process$1.stdout.columns : void 0,
      getErrHelpWidth: () => process$1.stderr.isTTY ? process$1.stderr.columns : void 0,
      outputError: (str, write) => write(str)
    };
    this._hidden = false;
    this._hasHelpOption = true;
    this._helpFlags = "-h, --help";
    this._helpDescription = "display help for command";
    this._helpShortFlag = "-h";
    this._helpLongFlag = "--help";
    this._addImplicitHelpCommand = void 0;
    this._helpCommandName = "help";
    this._helpCommandnameAndArgs = "help [command]";
    this._helpCommandDescription = "display help for command";
    this._helpConfiguration = {};
  }
  copyInheritedSettings(sourceCommand) {
    this._outputConfiguration = sourceCommand._outputConfiguration;
    this._hasHelpOption = sourceCommand._hasHelpOption;
    this._helpFlags = sourceCommand._helpFlags;
    this._helpDescription = sourceCommand._helpDescription;
    this._helpShortFlag = sourceCommand._helpShortFlag;
    this._helpLongFlag = sourceCommand._helpLongFlag;
    this._helpCommandName = sourceCommand._helpCommandName;
    this._helpCommandnameAndArgs = sourceCommand._helpCommandnameAndArgs;
    this._helpCommandDescription = sourceCommand._helpCommandDescription;
    this._helpConfiguration = sourceCommand._helpConfiguration;
    this._exitCallback = sourceCommand._exitCallback;
    this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
    this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
    this._allowExcessArguments = sourceCommand._allowExcessArguments;
    this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
    this._showHelpAfterError = sourceCommand._showHelpAfterError;
    this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
    return this;
  }
  command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
    let desc = actionOptsOrExecDesc;
    let opts = execOpts;
    if (typeof desc === "object" && desc !== null) {
      opts = desc;
      desc = null;
    }
    opts = opts || {};
    const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
    const cmd = this.createCommand(name);
    if (desc) {
      cmd.description(desc);
      cmd._executableHandler = true;
    }
    if (opts.isDefault)
      this._defaultCommandName = cmd._name;
    cmd._hidden = !!(opts.noHelp || opts.hidden);
    cmd._executableFile = opts.executableFile || null;
    if (args)
      cmd.arguments(args);
    this.commands.push(cmd);
    cmd.parent = this;
    cmd.copyInheritedSettings(this);
    if (desc)
      return this;
    return cmd;
  }
  createCommand(name) {
    return new Command$1(name);
  }
  createHelp() {
    return Object.assign(new Help$1(), this.configureHelp());
  }
  configureHelp(configuration) {
    if (configuration === void 0)
      return this._helpConfiguration;
    this._helpConfiguration = configuration;
    return this;
  }
  configureOutput(configuration) {
    if (configuration === void 0)
      return this._outputConfiguration;
    Object.assign(this._outputConfiguration, configuration);
    return this;
  }
  showHelpAfterError(displayHelp = true) {
    if (typeof displayHelp !== "string")
      displayHelp = !!displayHelp;
    this._showHelpAfterError = displayHelp;
    return this;
  }
  showSuggestionAfterError(displaySuggestion = true) {
    this._showSuggestionAfterError = !!displaySuggestion;
    return this;
  }
  addCommand(cmd, opts) {
    if (!cmd._name) {
      throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
    }
    opts = opts || {};
    if (opts.isDefault)
      this._defaultCommandName = cmd._name;
    if (opts.noHelp || opts.hidden)
      cmd._hidden = true;
    this.commands.push(cmd);
    cmd.parent = this;
    return this;
  }
  createArgument(name, description) {
    return new Argument$1(name, description);
  }
  argument(name, description, fn, defaultValue) {
    const argument = this.createArgument(name, description);
    if (typeof fn === "function") {
      argument.default(defaultValue).argParser(fn);
    } else {
      argument.default(fn);
    }
    this.addArgument(argument);
    return this;
  }
  arguments(names) {
    names.split(/ +/).forEach((detail) => {
      this.argument(detail);
    });
    return this;
  }
  addArgument(argument) {
    const previousArgument = this._args.slice(-1)[0];
    if (previousArgument && previousArgument.variadic) {
      throw new Error(`only the last argument can be variadic '${previousArgument.name()}'`);
    }
    if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
      throw new Error(`a default value for a required argument is never used: '${argument.name()}'`);
    }
    this._args.push(argument);
    return this;
  }
  addHelpCommand(enableOrNameAndArgs, description) {
    if (enableOrNameAndArgs === false) {
      this._addImplicitHelpCommand = false;
    } else {
      this._addImplicitHelpCommand = true;
      if (typeof enableOrNameAndArgs === "string") {
        this._helpCommandName = enableOrNameAndArgs.split(" ")[0];
        this._helpCommandnameAndArgs = enableOrNameAndArgs;
      }
      this._helpCommandDescription = description || this._helpCommandDescription;
    }
    return this;
  }
  _hasImplicitHelpCommand() {
    if (this._addImplicitHelpCommand === void 0) {
      return this.commands.length && !this._actionHandler && !this._findCommand("help");
    }
    return this._addImplicitHelpCommand;
  }
  hook(event, listener) {
    const allowedValues = ["preAction", "postAction"];
    if (!allowedValues.includes(event)) {
      throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
    }
    if (this._lifeCycleHooks[event]) {
      this._lifeCycleHooks[event].push(listener);
    } else {
      this._lifeCycleHooks[event] = [listener];
    }
    return this;
  }
  exitOverride(fn) {
    if (fn) {
      this._exitCallback = fn;
    } else {
      this._exitCallback = (err) => {
        if (err.code !== "commander.executeSubCommandAsync") {
          throw err;
        }
      };
    }
    return this;
  }
  _exit(exitCode, code, message) {
    if (this._exitCallback) {
      this._exitCallback(new CommanderError$1(exitCode, code, message));
    }
    process$1.exit(exitCode);
  }
  action(fn) {
    const listener = (args) => {
      const expectedArgsCount = this._args.length;
      const actionArgs = args.slice(0, expectedArgsCount);
      if (this._storeOptionsAsProperties) {
        actionArgs[expectedArgsCount] = this;
      } else {
        actionArgs[expectedArgsCount] = this.opts();
      }
      actionArgs.push(this);
      return fn.apply(this, actionArgs);
    };
    this._actionHandler = listener;
    return this;
  }
  createOption(flags, description) {
    return new Option$1(flags, description);
  }
  addOption(option) {
    const oname = option.name();
    const name = option.attributeName();
    if (option.negate) {
      const positiveLongFlag = option.long.replace(/^--no-/, "--");
      if (!this._findOption(positiveLongFlag)) {
        this.setOptionValueWithSource(name, option.defaultValue === void 0 ? true : option.defaultValue, "default");
      }
    } else if (option.defaultValue !== void 0) {
      this.setOptionValueWithSource(name, option.defaultValue, "default");
    }
    this.options.push(option);
    const handleOptionValue = (val, invalidValueMessage, valueSource) => {
      if (val == null && option.presetArg !== void 0) {
        val = option.presetArg;
      }
      const oldValue = this.getOptionValue(name);
      if (val !== null && option.parseArg) {
        try {
          val = option.parseArg(val, oldValue);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `${invalidValueMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      } else if (val !== null && option.variadic) {
        val = option._concatValue(val, oldValue);
      }
      if (val == null) {
        if (option.negate) {
          val = false;
        } else if (option.isBoolean() || option.optional) {
          val = true;
        } else {
          val = "";
        }
      }
      this.setOptionValueWithSource(name, val, valueSource);
    };
    this.on("option:" + oname, (val) => {
      const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
      handleOptionValue(val, invalidValueMessage, "cli");
    });
    if (option.envVar) {
      this.on("optionEnv:" + oname, (val) => {
        const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
        handleOptionValue(val, invalidValueMessage, "env");
      });
    }
    return this;
  }
  _optionEx(config, flags, description, fn, defaultValue) {
    if (typeof flags === "object" && flags instanceof Option$1) {
      throw new Error("To add an Option object use addOption() instead of option() or requiredOption()");
    }
    const option = this.createOption(flags, description);
    option.makeOptionMandatory(!!config.mandatory);
    if (typeof fn === "function") {
      option.default(defaultValue).argParser(fn);
    } else if (fn instanceof RegExp) {
      const regex = fn;
      fn = (val, def) => {
        const m = regex.exec(val);
        return m ? m[0] : def;
      };
      option.default(defaultValue).argParser(fn);
    } else {
      option.default(fn);
    }
    return this.addOption(option);
  }
  option(flags, description, fn, defaultValue) {
    return this._optionEx({}, flags, description, fn, defaultValue);
  }
  requiredOption(flags, description, fn, defaultValue) {
    return this._optionEx({ mandatory: true }, flags, description, fn, defaultValue);
  }
  combineFlagAndOptionalValue(combine = true) {
    this._combineFlagAndOptionalValue = !!combine;
    return this;
  }
  allowUnknownOption(allowUnknown = true) {
    this._allowUnknownOption = !!allowUnknown;
    return this;
  }
  allowExcessArguments(allowExcess = true) {
    this._allowExcessArguments = !!allowExcess;
    return this;
  }
  enablePositionalOptions(positional = true) {
    this._enablePositionalOptions = !!positional;
    return this;
  }
  passThroughOptions(passThrough = true) {
    this._passThroughOptions = !!passThrough;
    if (!!this.parent && passThrough && !this.parent._enablePositionalOptions) {
      throw new Error("passThroughOptions can not be used without turning on enablePositionalOptions for parent command(s)");
    }
    return this;
  }
  storeOptionsAsProperties(storeAsProperties = true) {
    this._storeOptionsAsProperties = !!storeAsProperties;
    if (this.options.length) {
      throw new Error("call .storeOptionsAsProperties() before adding options");
    }
    return this;
  }
  getOptionValue(key) {
    if (this._storeOptionsAsProperties) {
      return this[key];
    }
    return this._optionValues[key];
  }
  setOptionValue(key, value) {
    if (this._storeOptionsAsProperties) {
      this[key] = value;
    } else {
      this._optionValues[key] = value;
    }
    return this;
  }
  setOptionValueWithSource(key, value, source) {
    this.setOptionValue(key, value);
    this._optionValueSources[key] = source;
    return this;
  }
  getOptionValueSource(key) {
    return this._optionValueSources[key];
  }
  _prepareUserArgs(argv, parseOptions) {
    if (argv !== void 0 && !Array.isArray(argv)) {
      throw new Error("first parameter to parse must be array or undefined");
    }
    parseOptions = parseOptions || {};
    if (argv === void 0) {
      argv = process$1.argv;
      if (process$1.versions && process$1.versions.electron) {
        parseOptions.from = "electron";
      }
    }
    this.rawArgs = argv.slice();
    let userArgs;
    switch (parseOptions.from) {
      case void 0:
      case "node":
        this._scriptPath = argv[1];
        userArgs = argv.slice(2);
        break;
      case "electron":
        if (process$1.defaultApp) {
          this._scriptPath = argv[1];
          userArgs = argv.slice(2);
        } else {
          userArgs = argv.slice(1);
        }
        break;
      case "user":
        userArgs = argv.slice(0);
        break;
      default:
        throw new Error(`unexpected parse option { from: '${parseOptions.from}' }`);
    }
    if (!this._name && this._scriptPath)
      this.nameFromFilename(this._scriptPath);
    this._name = this._name || "program";
    return userArgs;
  }
  parse(argv, parseOptions) {
    const userArgs = this._prepareUserArgs(argv, parseOptions);
    this._parseCommand([], userArgs);
    return this;
  }
  async parseAsync(argv, parseOptions) {
    const userArgs = this._prepareUserArgs(argv, parseOptions);
    await this._parseCommand([], userArgs);
    return this;
  }
  _executeSubCommand(subcommand, args) {
    args = args.slice();
    let launchWithNode = false;
    const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
    function findFile(baseDir, baseName) {
      const localBin = path.resolve(baseDir, baseName);
      if (fs.existsSync(localBin))
        return localBin;
      if (sourceExt.includes(path.extname(baseName)))
        return void 0;
      const foundExt = sourceExt.find((ext) => fs.existsSync(`${localBin}${ext}`));
      if (foundExt)
        return `${localBin}${foundExt}`;
      return void 0;
    }
    this._checkForMissingMandatoryOptions();
    this._checkForConflictingOptions();
    let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
    let executableDir = this._executableDir || "";
    if (this._scriptPath) {
      let resolvedScriptPath;
      try {
        resolvedScriptPath = fs.realpathSync(this._scriptPath);
      } catch (err) {
        resolvedScriptPath = this._scriptPath;
      }
      executableDir = path.resolve(path.dirname(resolvedScriptPath), executableDir);
    }
    if (executableDir) {
      let localFile = findFile(executableDir, executableFile);
      if (!localFile && !subcommand._executableFile && this._scriptPath) {
        const legacyName = path.basename(this._scriptPath, path.extname(this._scriptPath));
        if (legacyName !== this._name) {
          localFile = findFile(executableDir, `${legacyName}-${subcommand._name}`);
        }
      }
      executableFile = localFile || executableFile;
    }
    launchWithNode = sourceExt.includes(path.extname(executableFile));
    let proc;
    if (process$1.platform !== "win32") {
      if (launchWithNode) {
        args.unshift(executableFile);
        args = incrementNodeInspectorPort(process$1.execArgv).concat(args);
        proc = childProcess.spawn(process$1.argv[0], args, { stdio: "inherit" });
      } else {
        proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
      }
    } else {
      args.unshift(executableFile);
      args = incrementNodeInspectorPort(process$1.execArgv).concat(args);
      proc = childProcess.spawn(process$1.execPath, args, { stdio: "inherit" });
    }
    if (!proc.killed) {
      const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
      signals.forEach((signal) => {
        process$1.on(signal, () => {
          if (proc.killed === false && proc.exitCode === null) {
            proc.kill(signal);
          }
        });
      });
    }
    const exitCallback = this._exitCallback;
    if (!exitCallback) {
      proc.on("close", process$1.exit.bind(process$1));
    } else {
      proc.on("close", () => {
        exitCallback(new CommanderError$1(process$1.exitCode || 0, "commander.executeSubCommandAsync", "(close)"));
      });
    }
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
        const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
        throw new Error(executableMissing);
      } else if (err.code === "EACCES") {
        throw new Error(`'${executableFile}' not executable`);
      }
      if (!exitCallback) {
        process$1.exit(1);
      } else {
        const wrappedError = new CommanderError$1(1, "commander.executeSubCommandAsync", "(error)");
        wrappedError.nestedError = err;
        exitCallback(wrappedError);
      }
    });
    this.runningCommand = proc;
  }
  _dispatchSubcommand(commandName, operands, unknown) {
    const subCommand = this._findCommand(commandName);
    if (!subCommand)
      this.help({ error: true });
    if (subCommand._executableHandler) {
      this._executeSubCommand(subCommand, operands.concat(unknown));
    } else {
      return subCommand._parseCommand(operands, unknown);
    }
  }
  _checkNumberOfArguments() {
    this._args.forEach((arg, i) => {
      if (arg.required && this.args[i] == null) {
        this.missingArgument(arg.name());
      }
    });
    if (this._args.length > 0 && this._args[this._args.length - 1].variadic) {
      return;
    }
    if (this.args.length > this._args.length) {
      this._excessArguments(this.args);
    }
  }
  _processArguments() {
    const myParseArg = (argument, value, previous) => {
      let parsedValue = value;
      if (value !== null && argument.parseArg) {
        try {
          parsedValue = argument.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'. ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      return parsedValue;
    };
    this._checkNumberOfArguments();
    const processedArgs = [];
    this._args.forEach((declaredArg, index) => {
      let value = declaredArg.defaultValue;
      if (declaredArg.variadic) {
        if (index < this.args.length) {
          value = this.args.slice(index);
          if (declaredArg.parseArg) {
            value = value.reduce((processed, v) => {
              return myParseArg(declaredArg, v, processed);
            }, declaredArg.defaultValue);
          }
        } else if (value === void 0) {
          value = [];
        }
      } else if (index < this.args.length) {
        value = this.args[index];
        if (declaredArg.parseArg) {
          value = myParseArg(declaredArg, value, declaredArg.defaultValue);
        }
      }
      processedArgs[index] = value;
    });
    this.processedArgs = processedArgs;
  }
  _chainOrCall(promise, fn) {
    if (promise && promise.then && typeof promise.then === "function") {
      return promise.then(() => fn());
    }
    return fn();
  }
  _chainOrCallHooks(promise, event) {
    let result = promise;
    const hooks = [];
    getCommandAndParents(this).reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
      hookedCommand._lifeCycleHooks[event].forEach((callback) => {
        hooks.push({ hookedCommand, callback });
      });
    });
    if (event === "postAction") {
      hooks.reverse();
    }
    hooks.forEach((hookDetail) => {
      result = this._chainOrCall(result, () => {
        return hookDetail.callback(hookDetail.hookedCommand, this);
      });
    });
    return result;
  }
  _parseCommand(operands, unknown) {
    const parsed = this.parseOptions(unknown);
    this._parseOptionsEnv();
    operands = operands.concat(parsed.operands);
    unknown = parsed.unknown;
    this.args = operands.concat(unknown);
    if (operands && this._findCommand(operands[0])) {
      return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
    }
    if (this._hasImplicitHelpCommand() && operands[0] === this._helpCommandName) {
      if (operands.length === 1) {
        this.help();
      }
      return this._dispatchSubcommand(operands[1], [], [this._helpLongFlag]);
    }
    if (this._defaultCommandName) {
      outputHelpIfRequested(this, unknown);
      return this._dispatchSubcommand(this._defaultCommandName, operands, unknown);
    }
    if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
      this.help({ error: true });
    }
    outputHelpIfRequested(this, parsed.unknown);
    this._checkForMissingMandatoryOptions();
    this._checkForConflictingOptions();
    const checkForUnknownOptions = () => {
      if (parsed.unknown.length > 0) {
        this.unknownOption(parsed.unknown[0]);
      }
    };
    const commandEvent = `command:${this.name()}`;
    if (this._actionHandler) {
      checkForUnknownOptions();
      this._processArguments();
      let actionResult;
      actionResult = this._chainOrCallHooks(actionResult, "preAction");
      actionResult = this._chainOrCall(actionResult, () => this._actionHandler(this.processedArgs));
      if (this.parent) {
        actionResult = this._chainOrCall(actionResult, () => {
          this.parent.emit(commandEvent, operands, unknown);
        });
      }
      actionResult = this._chainOrCallHooks(actionResult, "postAction");
      return actionResult;
    }
    if (this.parent && this.parent.listenerCount(commandEvent)) {
      checkForUnknownOptions();
      this._processArguments();
      this.parent.emit(commandEvent, operands, unknown);
    } else if (operands.length) {
      if (this._findCommand("*")) {
        return this._dispatchSubcommand("*", operands, unknown);
      }
      if (this.listenerCount("command:*")) {
        this.emit("command:*", operands, unknown);
      } else if (this.commands.length) {
        this.unknownCommand();
      } else {
        checkForUnknownOptions();
        this._processArguments();
      }
    } else if (this.commands.length) {
      checkForUnknownOptions();
      this.help({ error: true });
    } else {
      checkForUnknownOptions();
      this._processArguments();
    }
  }
  _findCommand(name) {
    if (!name)
      return void 0;
    return this.commands.find((cmd) => cmd._name === name || cmd._aliases.includes(name));
  }
  _findOption(arg) {
    return this.options.find((option) => option.is(arg));
  }
  _checkForMissingMandatoryOptions() {
    for (let cmd = this; cmd; cmd = cmd.parent) {
      cmd.options.forEach((anOption) => {
        if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
          cmd.missingMandatoryOptionValue(anOption);
        }
      });
    }
  }
  _checkForConflictingLocalOptions() {
    const definedNonDefaultOptions = this.options.filter((option) => {
      const optionKey = option.attributeName();
      if (this.getOptionValue(optionKey) === void 0) {
        return false;
      }
      return this.getOptionValueSource(optionKey) !== "default";
    });
    const optionsWithConflicting = definedNonDefaultOptions.filter((option) => option.conflictsWith.length > 0);
    optionsWithConflicting.forEach((option) => {
      const conflictingAndDefined = definedNonDefaultOptions.find((defined) => option.conflictsWith.includes(defined.attributeName()));
      if (conflictingAndDefined) {
        this._conflictingOption(option, conflictingAndDefined);
      }
    });
  }
  _checkForConflictingOptions() {
    for (let cmd = this; cmd; cmd = cmd.parent) {
      cmd._checkForConflictingLocalOptions();
    }
  }
  parseOptions(argv) {
    const operands = [];
    const unknown = [];
    let dest = operands;
    const args = argv.slice();
    function maybeOption(arg) {
      return arg.length > 1 && arg[0] === "-";
    }
    let activeVariadicOption = null;
    while (args.length) {
      const arg = args.shift();
      if (arg === "--") {
        if (dest === unknown)
          dest.push(arg);
        dest.push(...args);
        break;
      }
      if (activeVariadicOption && !maybeOption(arg)) {
        this.emit(`option:${activeVariadicOption.name()}`, arg);
        continue;
      }
      activeVariadicOption = null;
      if (maybeOption(arg)) {
        const option = this._findOption(arg);
        if (option) {
          if (option.required) {
            const value = args.shift();
            if (value === void 0)
              this.optionMissingArgument(option);
            this.emit(`option:${option.name()}`, value);
          } else if (option.optional) {
            let value = null;
            if (args.length > 0 && !maybeOption(args[0])) {
              value = args.shift();
            }
            this.emit(`option:${option.name()}`, value);
          } else {
            this.emit(`option:${option.name()}`);
          }
          activeVariadicOption = option.variadic ? option : null;
          continue;
        }
      }
      if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
        const option = this._findOption(`-${arg[1]}`);
        if (option) {
          if (option.required || option.optional && this._combineFlagAndOptionalValue) {
            this.emit(`option:${option.name()}`, arg.slice(2));
          } else {
            this.emit(`option:${option.name()}`);
            args.unshift(`-${arg.slice(2)}`);
          }
          continue;
        }
      }
      if (/^--[^=]+=/.test(arg)) {
        const index = arg.indexOf("=");
        const option = this._findOption(arg.slice(0, index));
        if (option && (option.required || option.optional)) {
          this.emit(`option:${option.name()}`, arg.slice(index + 1));
          continue;
        }
      }
      if (maybeOption(arg)) {
        dest = unknown;
      }
      if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
        if (this._findCommand(arg)) {
          operands.push(arg);
          if (args.length > 0)
            unknown.push(...args);
          break;
        } else if (arg === this._helpCommandName && this._hasImplicitHelpCommand()) {
          operands.push(arg);
          if (args.length > 0)
            operands.push(...args);
          break;
        } else if (this._defaultCommandName) {
          unknown.push(arg);
          if (args.length > 0)
            unknown.push(...args);
          break;
        }
      }
      if (this._passThroughOptions) {
        dest.push(arg);
        if (args.length > 0)
          dest.push(...args);
        break;
      }
      dest.push(arg);
    }
    return { operands, unknown };
  }
  opts() {
    if (this._storeOptionsAsProperties) {
      const result = {};
      const len = this.options.length;
      for (let i = 0; i < len; i++) {
        const key = this.options[i].attributeName();
        result[key] = key === this._versionOptionName ? this._version : this[key];
      }
      return result;
    }
    return this._optionValues;
  }
  optsWithGlobals() {
    return getCommandAndParents(this).reduce((combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()), {});
  }
  error(message, errorOptions) {
    this._outputConfiguration.outputError(`${message}
`, this._outputConfiguration.writeErr);
    if (typeof this._showHelpAfterError === "string") {
      this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
    } else if (this._showHelpAfterError) {
      this._outputConfiguration.writeErr("\n");
      this.outputHelp({ error: true });
    }
    const config = errorOptions || {};
    const exitCode = config.exitCode || 1;
    const code = config.code || "commander.error";
    this._exit(exitCode, code, message);
  }
  _parseOptionsEnv() {
    this.options.forEach((option) => {
      if (option.envVar && option.envVar in process$1.env) {
        const optionKey = option.attributeName();
        if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(this.getOptionValueSource(optionKey))) {
          if (option.required || option.optional) {
            this.emit(`optionEnv:${option.name()}`, process$1.env[option.envVar]);
          } else {
            this.emit(`optionEnv:${option.name()}`);
          }
        }
      }
    });
  }
  missingArgument(name) {
    const message = `error: missing required argument '${name}'`;
    this.error(message, { code: "commander.missingArgument" });
  }
  optionMissingArgument(option) {
    const message = `error: option '${option.flags}' argument missing`;
    this.error(message, { code: "commander.optionMissingArgument" });
  }
  missingMandatoryOptionValue(option) {
    const message = `error: required option '${option.flags}' not specified`;
    this.error(message, { code: "commander.missingMandatoryOptionValue" });
  }
  _conflictingOption(option, conflictingOption) {
    const findBestOptionFromValue = (option2) => {
      const optionKey = option2.attributeName();
      const optionValue = this.getOptionValue(optionKey);
      const negativeOption = this.options.find((target) => target.negate && optionKey === target.attributeName());
      const positiveOption = this.options.find((target) => !target.negate && optionKey === target.attributeName());
      if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
        return negativeOption;
      }
      return positiveOption || option2;
    };
    const getErrorMessage = (option2) => {
      const bestOption = findBestOptionFromValue(option2);
      const optionKey = bestOption.attributeName();
      const source = this.getOptionValueSource(optionKey);
      if (source === "env") {
        return `environment variable '${bestOption.envVar}'`;
      }
      return `option '${bestOption.flags}'`;
    };
    const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
    this.error(message, { code: "commander.conflictingOption" });
  }
  unknownOption(flag) {
    if (this._allowUnknownOption)
      return;
    let suggestion = "";
    if (flag.startsWith("--") && this._showSuggestionAfterError) {
      let candidateFlags = [];
      let command2 = this;
      do {
        const moreFlags = command2.createHelp().visibleOptions(command2).filter((option) => option.long).map((option) => option.long);
        candidateFlags = candidateFlags.concat(moreFlags);
        command2 = command2.parent;
      } while (command2 && !command2._enablePositionalOptions);
      suggestion = suggestSimilar(flag, candidateFlags);
    }
    const message = `error: unknown option '${flag}'${suggestion}`;
    this.error(message, { code: "commander.unknownOption" });
  }
  _excessArguments(receivedArgs) {
    if (this._allowExcessArguments)
      return;
    const expected = this._args.length;
    const s = expected === 1 ? "" : "s";
    const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
    const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
    this.error(message, { code: "commander.excessArguments" });
  }
  unknownCommand() {
    const unknownName = this.args[0];
    let suggestion = "";
    if (this._showSuggestionAfterError) {
      const candidateNames = [];
      this.createHelp().visibleCommands(this).forEach((command2) => {
        candidateNames.push(command2.name());
        if (command2.alias())
          candidateNames.push(command2.alias());
      });
      suggestion = suggestSimilar(unknownName, candidateNames);
    }
    const message = `error: unknown command '${unknownName}'${suggestion}`;
    this.error(message, { code: "commander.unknownCommand" });
  }
  version(str, flags, description) {
    if (str === void 0)
      return this._version;
    this._version = str;
    flags = flags || "-V, --version";
    description = description || "output the version number";
    const versionOption = this.createOption(flags, description);
    this._versionOptionName = versionOption.attributeName();
    this.options.push(versionOption);
    this.on("option:" + versionOption.name(), () => {
      this._outputConfiguration.writeOut(`${str}
`);
      this._exit(0, "commander.version", str);
    });
    return this;
  }
  description(str, argsDescription) {
    if (str === void 0 && argsDescription === void 0)
      return this._description;
    this._description = str;
    if (argsDescription) {
      this._argsDescription = argsDescription;
    }
    return this;
  }
  alias(alias) {
    if (alias === void 0)
      return this._aliases[0];
    let command2 = this;
    if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
      command2 = this.commands[this.commands.length - 1];
    }
    if (alias === command2._name)
      throw new Error("Command alias can't be the same as its name");
    command2._aliases.push(alias);
    return this;
  }
  aliases(aliases) {
    if (aliases === void 0)
      return this._aliases;
    aliases.forEach((alias) => this.alias(alias));
    return this;
  }
  usage(str) {
    if (str === void 0) {
      if (this._usage)
        return this._usage;
      const args = this._args.map((arg) => {
        return humanReadableArgName(arg);
      });
      return [].concat(this.options.length || this._hasHelpOption ? "[options]" : [], this.commands.length ? "[command]" : [], this._args.length ? args : []).join(" ");
    }
    this._usage = str;
    return this;
  }
  name(str) {
    if (str === void 0)
      return this._name;
    this._name = str;
    return this;
  }
  nameFromFilename(filename) {
    this._name = path.basename(filename, path.extname(filename));
    return this;
  }
  executableDir(path2) {
    if (path2 === void 0)
      return this._executableDir;
    this._executableDir = path2;
    return this;
  }
  helpInformation(contextOptions) {
    const helper = this.createHelp();
    if (helper.helpWidth === void 0) {
      helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
    }
    return helper.formatHelp(this, helper);
  }
  _getHelpContext(contextOptions) {
    contextOptions = contextOptions || {};
    const context = { error: !!contextOptions.error };
    let write;
    if (context.error) {
      write = (arg) => this._outputConfiguration.writeErr(arg);
    } else {
      write = (arg) => this._outputConfiguration.writeOut(arg);
    }
    context.write = contextOptions.write || write;
    context.command = this;
    return context;
  }
  outputHelp(contextOptions) {
    let deprecatedCallback;
    if (typeof contextOptions === "function") {
      deprecatedCallback = contextOptions;
      contextOptions = void 0;
    }
    const context = this._getHelpContext(contextOptions);
    getCommandAndParents(this).reverse().forEach((command2) => command2.emit("beforeAllHelp", context));
    this.emit("beforeHelp", context);
    let helpInformation = this.helpInformation(context);
    if (deprecatedCallback) {
      helpInformation = deprecatedCallback(helpInformation);
      if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
        throw new Error("outputHelp callback must return a string or a Buffer");
      }
    }
    context.write(helpInformation);
    this.emit(this._helpLongFlag);
    this.emit("afterHelp", context);
    getCommandAndParents(this).forEach((command2) => command2.emit("afterAllHelp", context));
  }
  helpOption(flags, description) {
    if (typeof flags === "boolean") {
      this._hasHelpOption = flags;
      return this;
    }
    this._helpFlags = flags || this._helpFlags;
    this._helpDescription = description || this._helpDescription;
    const helpFlags = splitOptionFlags(this._helpFlags);
    this._helpShortFlag = helpFlags.shortFlag;
    this._helpLongFlag = helpFlags.longFlag;
    return this;
  }
  help(contextOptions) {
    this.outputHelp(contextOptions);
    let exitCode = process$1.exitCode || 0;
    if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
      exitCode = 1;
    }
    this._exit(exitCode, "commander.help", "(outputHelp)");
  }
  addHelpText(position, text) {
    const allowedValues = ["beforeAll", "before", "after", "afterAll"];
    if (!allowedValues.includes(position)) {
      throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
    }
    const helpEvent = `${position}Help`;
    this.on(helpEvent, (context) => {
      let helpStr;
      if (typeof text === "function") {
        helpStr = text({ error: context.error, command: context.command });
      } else {
        helpStr = text;
      }
      if (helpStr) {
        context.write(`${helpStr}
`);
      }
    });
    return this;
  }
}
function outputHelpIfRequested(cmd, args) {
  const helpOption = cmd._hasHelpOption && args.find((arg) => arg === cmd._helpLongFlag || arg === cmd._helpShortFlag);
  if (helpOption) {
    cmd.outputHelp();
    cmd._exit(0, "commander.helpDisplayed", "(outputHelp)");
  }
}
function incrementNodeInspectorPort(args) {
  return args.map((arg) => {
    if (!arg.startsWith("--inspect")) {
      return arg;
    }
    let debugOption;
    let debugHost = "127.0.0.1";
    let debugPort = "9229";
    let match;
    if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
      debugOption = match[1];
    } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
      debugOption = match[1];
      if (/^\d+$/.test(match[3])) {
        debugPort = match[3];
      } else {
        debugHost = match[3];
      }
    } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
      debugOption = match[1];
      debugHost = match[3];
      debugPort = match[4];
    }
    if (debugOption && debugPort !== "0") {
      return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
    }
    return arg;
  });
}
function getCommandAndParents(startCommand) {
  const result = [];
  for (let command2 = startCommand; command2; command2 = command2.parent) {
    result.push(command2);
  }
  return result;
}
command.Command = Command$1;

(function(module, exports) {
  const { Argument } = argument;
  const { Command } = command;
  const { CommanderError, InvalidArgumentError } = error;
  const { Help } = help;
  const { Option } = option;
  exports = module.exports = new Command();
  exports.program = exports;
  exports.Argument = Argument;
  exports.Command = Command;
  exports.CommanderError = CommanderError;
  exports.Help = Help;
  exports.InvalidArgumentError = InvalidArgumentError;
  exports.InvalidOptionArgumentError = InvalidArgumentError;
  exports.Option = Option;
})(commander, commander.exports);
var commander_default = commander.exports;

const {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  Command,
  Argument,
  Option,
  Help
} = commander_default;

var picocolors = { exports: {} };

let tty = require$$0$1;
let isColorSupported = !("NO_COLOR" in process.env || process.argv.includes("--no-color")) && ("FORCE_COLOR" in process.env || process.argv.includes("--color") || process.platform === "win32" || tty.isatty(1) && process.env.TERM !== "dumb" || "CI" in process.env);
let formatter = (open, close, replace = open) => (input) => {
  let string = "" + input;
  let index = string.indexOf(close, open.length);
  return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
};
let replaceClose = (string, close, replace, index) => {
  let start = string.substring(0, index) + replace;
  let end = string.substring(index + close.length);
  let nextIndex = end.indexOf(close);
  return ~nextIndex ? start + replaceClose(end, close, replace, nextIndex) : start + end;
};
let createColors = (enabled = isColorSupported) => ({
  isColorSupported: enabled,
  reset: enabled ? (s) => `\x1B[0m${s}\x1B[0m` : String,
  bold: enabled ? formatter("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m") : String,
  dim: enabled ? formatter("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m") : String,
  italic: enabled ? formatter("\x1B[3m", "\x1B[23m") : String,
  underline: enabled ? formatter("\x1B[4m", "\x1B[24m") : String,
  inverse: enabled ? formatter("\x1B[7m", "\x1B[27m") : String,
  hidden: enabled ? formatter("\x1B[8m", "\x1B[28m") : String,
  strikethrough: enabled ? formatter("\x1B[9m", "\x1B[29m") : String,
  black: enabled ? formatter("\x1B[30m", "\x1B[39m") : String,
  red: enabled ? formatter("\x1B[31m", "\x1B[39m") : String,
  green: enabled ? formatter("\x1B[32m", "\x1B[39m") : String,
  yellow: enabled ? formatter("\x1B[33m", "\x1B[39m") : String,
  blue: enabled ? formatter("\x1B[34m", "\x1B[39m") : String,
  magenta: enabled ? formatter("\x1B[35m", "\x1B[39m") : String,
  cyan: enabled ? formatter("\x1B[36m", "\x1B[39m") : String,
  white: enabled ? formatter("\x1B[37m", "\x1B[39m") : String,
  gray: enabled ? formatter("\x1B[90m", "\x1B[39m") : String,
  bgBlack: enabled ? formatter("\x1B[40m", "\x1B[49m") : String,
  bgRed: enabled ? formatter("\x1B[41m", "\x1B[49m") : String,
  bgGreen: enabled ? formatter("\x1B[42m", "\x1B[49m") : String,
  bgYellow: enabled ? formatter("\x1B[43m", "\x1B[49m") : String,
  bgBlue: enabled ? formatter("\x1B[44m", "\x1B[49m") : String,
  bgMagenta: enabled ? formatter("\x1B[45m", "\x1B[49m") : String,
  bgCyan: enabled ? formatter("\x1B[46m", "\x1B[49m") : String,
  bgWhite: enabled ? formatter("\x1B[47m", "\x1B[49m") : String
});
picocolors.exports = createColors();
picocolors.exports.createColors = createColors;

const getModuleRootDirectoryForImportMetaUrl = (opts) => {
  const __fileName = fileURLToPath(new URL(opts.importMetaUrl));
  const parent = dirname(__fileName);
  const superParent = dirname(parent);
  const isBundledInDist = () => parent.endsWith("/dist");
  const isBundledInBin = () => parent.endsWith("/bin") && !superParent.endsWith("/src");
  if (isBundledInDist() || isBundledInBin()) {
    return fileURLToPath(new URL(`../`, opts.importMetaUrl));
  }
  return fileURLToPath(new URL(`../../`, opts.importMetaUrl));
};
const moduleRootDirectory = once(() => getModuleRootDirectoryForImportMetaUrl({ importMetaUrl: import.meta.url }));

function configFilePath(pathRelativeToConfigDir) {
  return join(moduleRootDirectory(), `./configs/${pathRelativeToConfigDir}`);
}

const readPackagesGlobs = async (monorepoRoot) => {
  try {
    const text = await readFile(join(monorepoRoot, "pnpm-workspace.yaml"), "utf-8");
    const rootPath = load(text);
    return rootPath.packages ?? [];
  } catch (err) {
    logger.error(err);
    return [];
  }
};

async function ensureEslintTsConfigExists() {
  const root = await monorepoRootPath();
  const expected = join(root, "tsconfig.eslint.json");
  const eslintConfigExists = await stat(expected).then((result) => result.isFile()).catch(() => false);
  if (eslintConfigExists) {
    return;
  }
  const text = await readFile(configFilePath("eslint/tsconfig.eslint.json"), {
    encoding: "utf-8"
  });
  const globs = await readPackagesGlobs(root);
  await writeFile(expected, text.replace("GLOBS", JSON.stringify([
    ...new Set(globs.map((glob) => glob !== "*" ? `${glob}/*.ts` : `*.ts`))
  ])));
}
async function ensureEslintRootConfigExists() {
  const root = await monorepoRootPath();
  const expected = join(root, ".eslintrc.cjs");
  const eslintConfigExists = await stat(expected).then((result) => result.isFile()).catch(() => false);
  if (eslintConfigExists) {
    return;
  }
  const text = await readFile(configFilePath("eslint/eslint-ref.cjs"), {
    encoding: "utf-8"
  });
  await writeFile(expected, text);
}
async function ensureEslintConfigFilesExist() {
  await Promise.all([
    ensureEslintTsConfigExists(),
    ensureEslintRootConfigExists()
  ]);
}

function modulesBinPath(bin) {
  return join(moduleRootDirectory(), `./node_modules/.bin/${bin}`);
}

const eslintPath = () => modulesBinPath("eslint");
const eslintConfigPath = () => configFilePath("./eslint/eslint-root.cjs");
const eslint$1 = async (processArgs) => spawnToPromise(eslintPath(), taskArgsPipe([
  setDefaultArgs(["--format"], ["unix"]),
  setDefaultArgs(["--ext"], [[".ts", ".tsx", ".js", ".jsx", ".cjs", ".json"].join(",")]),
  setDefaultArgs(["--config", "-c"], [eslintConfigPath()]),
  setDefaultArgs(["--fix"], [], (args) => !includesAnyOf(args.inputArgs, ["--no-fix"])),
  removeInputArgs(["--no-fix"]),
  (args) => ({
    ...args,
    inputArgs: args.inputArgs.length === 0 ? ["."] : args.inputArgs
  })
], processArgs), {
  stdio: "inherit"
});

function declareTask(opts) {
  return opts;
}

async function ensureTsConfigExists() {
  const cwdPackageJsonPath = join(process.cwd(), "package.json");
  const packageJsonExists = await stat(cwdPackageJsonPath).then((result) => result.isFile()).catch(() => false);
  if (!packageJsonExists) {
    return;
  }
  const expected = join(process.cwd(), "tsconfig.json");
  const configExists = await stat(expected).then((result) => result.isFile()).catch(() => false);
  if (configExists) {
    return;
  }
  const text = await readFile(configFilePath("tsconfig.pkg.json"), {
    encoding: "utf-8"
  });
  await writeFile(expected, text);
}

const tscPath = () => modulesBinPath("tsc");
const tsc$1 = async (args) => spawnToPromise(tscPath(), args, {
  stdio: "inherit",
  cwd: relative(process.cwd(), await monorepoRootPath())
});
const tscCompositeTypeCheckAt = async (packageDirectory) => tsc$1(["--build", join(packageDirectory, "./tsconfig.json")]);
const tscCompositeTypeCheck = async () => tscCompositeTypeCheckAt(process.cwd());

async function allFulfilled(args) {
  const results = await Promise.allSettled(args);
  const resultsArr = results;
  for (const result of resultsArr) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
  return results;
}

function lint(opts) {
  return declareTask({
    name: "lint",
    args: void 0,
    execute: async () => {
      const root = await monorepoRootPath();
      if (root === process.cwd()) {
        const srcDir = await stat("./src").catch(() => null);
        if (!srcDir || !srcDir.isDirectory()) {
          return;
        }
      }
      await allFulfilled([
        ensureTsConfigExists().then(() => tscCompositeTypeCheck()),
        ensureEslintConfigFilesExist().then(() => eslint$1(opts == null ? void 0 : opts.processArgs))
      ]);
    }
  });
}

const cwdPackageJsonPath = () => join(process.cwd(), "./package.json");
async function readPackageJsonAt(path) {
  return await readFile(path, "utf-8").then((result) => JSON.parse(result));
}
const readCwdPackageJson = onceAsync(() => readPackageJsonAt(cwdPackageJsonPath()));

function enableSourceMapsSupport() {
  if ("setSourceMapsEnabled" in process) {
    process.setSourceMapsEnabled(true);
  }
}

const postTaskNames = ["copy"];
const mainTaskNames = [
  "lint",
  "build",
  "test",
  "declarations",
  "integration"
];
async function pipeline(...tasks) {
  const start = performance.now();
  try {
    enableSourceMapsSupport();
    const { custom, main, post } = tasks.reduce((acc, task) => {
      if (typeof task === "function") {
        acc.custom.push(task);
        return acc;
      }
      if (mainTaskNames.includes(task.name)) {
        acc.main.push(task);
        return acc;
      }
      if (postTaskNames.includes(task.name)) {
        acc.post.push(task);
        return acc;
      }
      return acc;
    }, {
      custom: [],
      main: [],
      post: []
    });
    const executeTask = async (task) => {
      var _a;
      try {
        return typeof task === "function" ? await task() : await Promise.resolve((_a = task.execute) == null ? void 0 : _a.call(task));
      } catch (err) {
        logger.error(err);
        logger.error(picocolors.exports.red(`
ERROR: Failed to ${task.name || "execute a task"} ${String((await readCwdPackageJson()).name)} "${err instanceof Error ? err.message : String(err)}"`));
        return Promise.reject(err);
      }
    };
    await allFulfilled([...main, ...custom].map(executeTask));
    await allFulfilled(post.map(executeTask));
  } catch (err) {
    if (typeof process.exitCode !== "number") {
      process.exitCode = 1;
    }
  } finally {
    const end = performance.now();
    const toSeconds = (value) => `${(value / 1e3).toFixed(2)}s`;
    logger.log(`
Task took ${toSeconds(end - start)}`);
  }
}

const eslint = () => picocolors.exports.yellow("eslint");
const tsc = () => picocolors.exports.blue("tsc");
const lintCommand = () => new Command("lint").description(`Lint and check for TypeScript errors for package in current directory using ${eslint()} and ${tsc()}`).helpOption(false).addHelpText("after", `
${eslint()} options can be passed in and will be forwarded, otherwise default bespoke config and options are used`).allowUnknownOption(true).action(async (_opts, command) => {
  if (command.args.includes("-h") || command.args.includes("--help")) {
    console.log(command.helpInformation());
  }
  await pipeline(lint({ processArgs: command.args }));
});

const repkaCommand = () => new Command("repka").passThroughOptions(true).addCommand(lintCommand());
async function run() {
  await repkaCommand().parseAsync();
}
await run();

export { repkaCommand };
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwa2EuZ2VuLm1qcyIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL2NvbW1hbmRlckA5LjIuMC9ub2RlX21vZHVsZXMvY29tbWFuZGVyL2xpYi9lcnJvci5qcyIsIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9jb21tYW5kZXJAOS4yLjAvbm9kZV9tb2R1bGVzL2NvbW1hbmRlci9saWIvYXJndW1lbnQuanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vY29tbWFuZGVyQDkuMi4wL25vZGVfbW9kdWxlcy9jb21tYW5kZXIvbGliL2hlbHAuanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vY29tbWFuZGVyQDkuMi4wL25vZGVfbW9kdWxlcy9jb21tYW5kZXIvbGliL29wdGlvbi5qcyIsIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9jb21tYW5kZXJAOS4yLjAvbm9kZV9tb2R1bGVzL2NvbW1hbmRlci9saWIvc3VnZ2VzdFNpbWlsYXIuanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vY29tbWFuZGVyQDkuMi4wL25vZGVfbW9kdWxlcy9jb21tYW5kZXIvbGliL2NvbW1hbmQuanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vY29tbWFuZGVyQDkuMi4wL25vZGVfbW9kdWxlcy9jb21tYW5kZXIvaW5kZXguanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vY29tbWFuZGVyQDkuMi4wL25vZGVfbW9kdWxlcy9jb21tYW5kZXIvZXNtLm1qcyIsIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9waWNvY29sb3JzQDEuMC4wL25vZGVfbW9kdWxlcy9waWNvY29sb3JzL3BpY29jb2xvcnMuanMiLCIuLi9zcmMvdXRpbHMvbW9kdWxlUm9vdERpcmVjdG9yeS50cyIsIi4uL3NyYy91dGlscy9jb25maWdGaWxlUGF0aC50cyIsIi4uL3NyYy91dGlscy9yZWFkUGFja2FnZXNHbG9icy50cyIsIi4uL3NyYy9lc2xpbnQvZW5zdXJlRXNsaW50Q29uZmlnRmlsZXNFeGlzdC50cyIsIi4uL3NyYy91dGlscy9tb2R1bGVzQmluUGF0aC50cyIsIi4uL3NyYy9lc2xpbnQvZXNsaW50LnRzIiwiLi4vc3JjL3Rhc2tzL2RlY2xhcmVUYXNrLnRzIiwiLi4vc3JjL3RzYy9lbnN1cmVUc0NvbmZpZ0V4aXN0cy50cyIsIi4uL3NyYy90c2MvdHNjLnRzIiwiLi4vc3JjL3V0aWxzL2FsbEZ1bGxmaWxsZWQudHMiLCIuLi9zcmMvbGludC50cyIsIi4uL3NyYy9wYWNrYWdlLWpzb24vcmVhZFBhY2thZ2VKc29uLnRzIiwiLi4vc3JjL3V0aWxzL2VuYWJsZVNvdXJjZU1hcHNTdXBwb3J0LnRzIiwiLi4vc3JjL3BpcGVsaW5lLnRzIiwiLi4vc3JjL2NsaS9saW50L2xpbnQudHMiLCIuLi9zcmMvY2xpL3JlcGthLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIENvbW1hbmRlckVycm9yIGNsYXNzXG4gKiBAY2xhc3NcbiAqL1xuY2xhc3MgQ29tbWFuZGVyRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBDb25zdHJ1Y3RzIHRoZSBDb21tYW5kZXJFcnJvciBjbGFzc1xuICAgKiBAcGFyYW0ge251bWJlcn0gZXhpdENvZGUgc3VnZ2VzdGVkIGV4aXQgY29kZSB3aGljaCBjb3VsZCBiZSB1c2VkIHdpdGggcHJvY2Vzcy5leGl0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2RlIGFuIGlkIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIGVycm9yXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIGh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9uIG9mIHRoZSBlcnJvclxuICAgKiBAY29uc3RydWN0b3JcbiAgICovXG4gIGNvbnN0cnVjdG9yKGV4aXRDb2RlLCBjb2RlLCBtZXNzYWdlKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgLy8gcHJvcGVybHkgY2FwdHVyZSBzdGFjayB0cmFjZSBpbiBOb2RlLmpzXG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgdGhpcy5jb25zdHJ1Y3Rvcik7XG4gICAgdGhpcy5uYW1lID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIHRoaXMuY29kZSA9IGNvZGU7XG4gICAgdGhpcy5leGl0Q29kZSA9IGV4aXRDb2RlO1xuICAgIHRoaXMubmVzdGVkRXJyb3IgPSB1bmRlZmluZWQ7XG4gIH1cbn1cblxuLyoqXG4gKiBJbnZhbGlkQXJndW1lbnRFcnJvciBjbGFzc1xuICogQGNsYXNzXG4gKi9cbmNsYXNzIEludmFsaWRBcmd1bWVudEVycm9yIGV4dGVuZHMgQ29tbWFuZGVyRXJyb3Ige1xuICAvKipcbiAgICogQ29uc3RydWN0cyB0aGUgSW52YWxpZEFyZ3VtZW50RXJyb3IgY2xhc3NcbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXNzYWdlXSBleHBsYW5hdGlvbiBvZiB3aHkgYXJndW1lbnQgaXMgaW52YWxpZFxuICAgKiBAY29uc3RydWN0b3JcbiAgICovXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UpIHtcbiAgICBzdXBlcigxLCAnY29tbWFuZGVyLmludmFsaWRBcmd1bWVudCcsIG1lc3NhZ2UpO1xuICAgIC8vIHByb3Blcmx5IGNhcHR1cmUgc3RhY2sgdHJhY2UgaW4gTm9kZS5qc1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIHRoaXMuY29uc3RydWN0b3IpO1xuICAgIHRoaXMubmFtZSA9IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgfVxufVxuXG5leHBvcnRzLkNvbW1hbmRlckVycm9yID0gQ29tbWFuZGVyRXJyb3I7XG5leHBvcnRzLkludmFsaWRBcmd1bWVudEVycm9yID0gSW52YWxpZEFyZ3VtZW50RXJyb3I7XG4iLCJjb25zdCB7IEludmFsaWRBcmd1bWVudEVycm9yIH0gPSByZXF1aXJlKCcuL2Vycm9yLmpzJyk7XG5cbi8vIEB0cy1jaGVja1xuXG5jbGFzcyBBcmd1bWVudCB7XG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGEgbmV3IGNvbW1hbmQgYXJndW1lbnQgd2l0aCB0aGUgZ2l2ZW4gbmFtZSBhbmQgZGVzY3JpcHRpb24uXG4gICAqIFRoZSBkZWZhdWx0IGlzIHRoYXQgdGhlIGFyZ3VtZW50IGlzIHJlcXVpcmVkLCBhbmQgeW91IGNhbiBleHBsaWNpdGx5XG4gICAqIGluZGljYXRlIHRoaXMgd2l0aCA8PiBhcm91bmQgdGhlIG5hbWUuIFB1dCBbXSBhcm91bmQgdGhlIG5hbWUgZm9yIGFuIG9wdGlvbmFsIGFyZ3VtZW50LlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2Rlc2NyaXB0aW9uXVxuICAgKi9cblxuICBjb25zdHJ1Y3RvcihuYW1lLCBkZXNjcmlwdGlvbikge1xuICAgIHRoaXMuZGVzY3JpcHRpb24gPSBkZXNjcmlwdGlvbiB8fCAnJztcbiAgICB0aGlzLnZhcmlhZGljID0gZmFsc2U7XG4gICAgdGhpcy5wYXJzZUFyZyA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLmRlZmF1bHRWYWx1ZSA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLmRlZmF1bHRWYWx1ZURlc2NyaXB0aW9uID0gdW5kZWZpbmVkO1xuICAgIHRoaXMuYXJnQ2hvaWNlcyA9IHVuZGVmaW5lZDtcblxuICAgIHN3aXRjaCAobmFtZVswXSkge1xuICAgICAgY2FzZSAnPCc6IC8vIGUuZy4gPHJlcXVpcmVkPlxuICAgICAgICB0aGlzLnJlcXVpcmVkID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fbmFtZSA9IG5hbWUuc2xpY2UoMSwgLTEpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1snOiAvLyBlLmcuIFtvcHRpb25hbF1cbiAgICAgICAgdGhpcy5yZXF1aXJlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9uYW1lID0gbmFtZS5zbGljZSgxLCAtMSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5yZXF1aXJlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuX25hbWUgPSBuYW1lO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fbmFtZS5sZW5ndGggPiAzICYmIHRoaXMuX25hbWUuc2xpY2UoLTMpID09PSAnLi4uJykge1xuICAgICAgdGhpcy52YXJpYWRpYyA9IHRydWU7XG4gICAgICB0aGlzLl9uYW1lID0gdGhpcy5fbmFtZS5zbGljZSgwLCAtMyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBhcmd1bWVudCBuYW1lLlxuICAgKlxuICAgKiBAcmV0dXJuIHtzdHJpbmd9XG4gICAqL1xuXG4gIG5hbWUoKSB7XG4gICAgcmV0dXJuIHRoaXMuX25hbWU7XG4gIH1cblxuICAvKipcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIF9jb25jYXRWYWx1ZSh2YWx1ZSwgcHJldmlvdXMpIHtcbiAgICBpZiAocHJldmlvdXMgPT09IHRoaXMuZGVmYXVsdFZhbHVlIHx8ICFBcnJheS5pc0FycmF5KHByZXZpb3VzKSkge1xuICAgICAgcmV0dXJuIFt2YWx1ZV07XG4gICAgfVxuXG4gICAgcmV0dXJuIHByZXZpb3VzLmNvbmNhdCh2YWx1ZSk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHRoZSBkZWZhdWx0IHZhbHVlLCBhbmQgb3B0aW9uYWxseSBzdXBwbHkgdGhlIGRlc2NyaXB0aW9uIHRvIGJlIGRpc3BsYXllZCBpbiB0aGUgaGVscC5cbiAgICpcbiAgICogQHBhcmFtIHthbnl9IHZhbHVlXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dXG4gICAqIEByZXR1cm4ge0FyZ3VtZW50fVxuICAgKi9cblxuICBkZWZhdWx0KHZhbHVlLCBkZXNjcmlwdGlvbikge1xuICAgIHRoaXMuZGVmYXVsdFZhbHVlID0gdmFsdWU7XG4gICAgdGhpcy5kZWZhdWx0VmFsdWVEZXNjcmlwdGlvbiA9IGRlc2NyaXB0aW9uO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCB0aGUgY3VzdG9tIGhhbmRsZXIgZm9yIHByb2Nlc3NpbmcgQ0xJIGNvbW1hbmQgYXJndW1lbnRzIGludG8gYXJndW1lbnQgdmFsdWVzLlxuICAgKlxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbZm5dXG4gICAqIEByZXR1cm4ge0FyZ3VtZW50fVxuICAgKi9cblxuICBhcmdQYXJzZXIoZm4pIHtcbiAgICB0aGlzLnBhcnNlQXJnID0gZm47XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogT25seSBhbGxvdyBhcmd1bWVudCB2YWx1ZSB0byBiZSBvbmUgb2YgY2hvaWNlcy5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdmFsdWVzXG4gICAqIEByZXR1cm4ge0FyZ3VtZW50fVxuICAgKi9cblxuICBjaG9pY2VzKHZhbHVlcykge1xuICAgIHRoaXMuYXJnQ2hvaWNlcyA9IHZhbHVlcy5zbGljZSgpO1xuICAgIHRoaXMucGFyc2VBcmcgPSAoYXJnLCBwcmV2aW91cykgPT4ge1xuICAgICAgaWYgKCF0aGlzLmFyZ0Nob2ljZXMuaW5jbHVkZXMoYXJnKSkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEFyZ3VtZW50RXJyb3IoYEFsbG93ZWQgY2hvaWNlcyBhcmUgJHt0aGlzLmFyZ0Nob2ljZXMuam9pbignLCAnKX0uYCk7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy52YXJpYWRpYykge1xuICAgICAgICByZXR1cm4gdGhpcy5fY29uY2F0VmFsdWUoYXJnLCBwcmV2aW91cyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gYXJnO1xuICAgIH07XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogTWFrZSBhcmd1bWVudCByZXF1aXJlZC5cbiAgICovXG4gIGFyZ1JlcXVpcmVkKCkge1xuICAgIHRoaXMucmVxdWlyZWQgPSB0cnVlO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIE1ha2UgYXJndW1lbnQgb3B0aW9uYWwuXG4gICAqL1xuICBhcmdPcHRpb25hbCgpIHtcbiAgICB0aGlzLnJlcXVpcmVkID0gZmFsc2U7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbn1cblxuLyoqXG4gKiBUYWtlcyBhbiBhcmd1bWVudCBhbmQgcmV0dXJucyBpdHMgaHVtYW4gcmVhZGFibGUgZXF1aXZhbGVudCBmb3IgaGVscCB1c2FnZS5cbiAqXG4gKiBAcGFyYW0ge0FyZ3VtZW50fSBhcmdcbiAqIEByZXR1cm4ge3N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGh1bWFuUmVhZGFibGVBcmdOYW1lKGFyZykge1xuICBjb25zdCBuYW1lT3V0cHV0ID0gYXJnLm5hbWUoKSArIChhcmcudmFyaWFkaWMgPT09IHRydWUgPyAnLi4uJyA6ICcnKTtcblxuICByZXR1cm4gYXJnLnJlcXVpcmVkXG4gICAgPyAnPCcgKyBuYW1lT3V0cHV0ICsgJz4nXG4gICAgOiAnWycgKyBuYW1lT3V0cHV0ICsgJ10nO1xufVxuXG5leHBvcnRzLkFyZ3VtZW50ID0gQXJndW1lbnQ7XG5leHBvcnRzLmh1bWFuUmVhZGFibGVBcmdOYW1lID0gaHVtYW5SZWFkYWJsZUFyZ05hbWU7XG4iLCJjb25zdCB7IGh1bWFuUmVhZGFibGVBcmdOYW1lIH0gPSByZXF1aXJlKCcuL2FyZ3VtZW50LmpzJyk7XG5cbi8qKlxuICogVHlwZVNjcmlwdCBpbXBvcnQgdHlwZXMgZm9yIEpTRG9jLCB1c2VkIGJ5IFZpc3VhbCBTdHVkaW8gQ29kZSBJbnRlbGxpU2Vuc2UgYW5kIGBucG0gcnVuIHR5cGVzY3JpcHQtY2hlY2tKU2BcbiAqIGh0dHBzOi8vd3d3LnR5cGVzY3JpcHRsYW5nLm9yZy9kb2NzL2hhbmRib29rL2pzZG9jLXN1cHBvcnRlZC10eXBlcy5odG1sI2ltcG9ydC10eXBlc1xuICogQHR5cGVkZWYgeyBpbXBvcnQoXCIuL2FyZ3VtZW50LmpzXCIpLkFyZ3VtZW50IH0gQXJndW1lbnRcbiAqIEB0eXBlZGVmIHsgaW1wb3J0KFwiLi9jb21tYW5kLmpzXCIpLkNvbW1hbmQgfSBDb21tYW5kXG4gKiBAdHlwZWRlZiB7IGltcG9ydChcIi4vb3B0aW9uLmpzXCIpLk9wdGlvbiB9IE9wdGlvblxuICovXG5cbi8vIEB0cy1jaGVja1xuXG4vLyBBbHRob3VnaCB0aGlzIGlzIGEgY2xhc3MsIG1ldGhvZHMgYXJlIHN0YXRpYyBpbiBzdHlsZSB0byBhbGxvdyBvdmVycmlkZSB1c2luZyBzdWJjbGFzcyBvciBqdXN0IGZ1bmN0aW9ucy5cbmNsYXNzIEhlbHAge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLmhlbHBXaWR0aCA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLnNvcnRTdWJjb21tYW5kcyA9IGZhbHNlO1xuICAgIHRoaXMuc29ydE9wdGlvbnMgPSBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYW4gYXJyYXkgb2YgdGhlIHZpc2libGUgc3ViY29tbWFuZHMuIEluY2x1ZGVzIGEgcGxhY2Vob2xkZXIgZm9yIHRoZSBpbXBsaWNpdCBoZWxwIGNvbW1hbmQsIGlmIHRoZXJlIGlzIG9uZS5cbiAgICpcbiAgICogQHBhcmFtIHtDb21tYW5kfSBjbWRcbiAgICogQHJldHVybnMge0NvbW1hbmRbXX1cbiAgICovXG5cbiAgdmlzaWJsZUNvbW1hbmRzKGNtZCkge1xuICAgIGNvbnN0IHZpc2libGVDb21tYW5kcyA9IGNtZC5jb21tYW5kcy5maWx0ZXIoY21kID0+ICFjbWQuX2hpZGRlbik7XG4gICAgaWYgKGNtZC5faGFzSW1wbGljaXRIZWxwQ29tbWFuZCgpKSB7XG4gICAgICAvLyBDcmVhdGUgYSBjb21tYW5kIG1hdGNoaW5nIHRoZSBpbXBsaWNpdCBoZWxwIGNvbW1hbmQuXG4gICAgICBjb25zdCBbLCBoZWxwTmFtZSwgaGVscEFyZ3NdID0gY21kLl9oZWxwQ29tbWFuZG5hbWVBbmRBcmdzLm1hdGNoKC8oW14gXSspICooLiopLyk7XG4gICAgICBjb25zdCBoZWxwQ29tbWFuZCA9IGNtZC5jcmVhdGVDb21tYW5kKGhlbHBOYW1lKVxuICAgICAgICAuaGVscE9wdGlvbihmYWxzZSk7XG4gICAgICBoZWxwQ29tbWFuZC5kZXNjcmlwdGlvbihjbWQuX2hlbHBDb21tYW5kRGVzY3JpcHRpb24pO1xuICAgICAgaWYgKGhlbHBBcmdzKSBoZWxwQ29tbWFuZC5hcmd1bWVudHMoaGVscEFyZ3MpO1xuICAgICAgdmlzaWJsZUNvbW1hbmRzLnB1c2goaGVscENvbW1hbmQpO1xuICAgIH1cbiAgICBpZiAodGhpcy5zb3J0U3ViY29tbWFuZHMpIHtcbiAgICAgIHZpc2libGVDb21tYW5kcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIC8vIEB0cy1pZ25vcmU6IG92ZXJsb2FkZWQgcmV0dXJuIHR5cGVcbiAgICAgICAgcmV0dXJuIGEubmFtZSgpLmxvY2FsZUNvbXBhcmUoYi5uYW1lKCkpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiB2aXNpYmxlQ29tbWFuZHM7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGFuIGFycmF5IG9mIHRoZSB2aXNpYmxlIG9wdGlvbnMuIEluY2x1ZGVzIGEgcGxhY2Vob2xkZXIgZm9yIHRoZSBpbXBsaWNpdCBoZWxwIG9wdGlvbiwgaWYgdGhlcmUgaXMgb25lLlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbW1hbmR9IGNtZFxuICAgKiBAcmV0dXJucyB7T3B0aW9uW119XG4gICAqL1xuXG4gIHZpc2libGVPcHRpb25zKGNtZCkge1xuICAgIGNvbnN0IHZpc2libGVPcHRpb25zID0gY21kLm9wdGlvbnMuZmlsdGVyKChvcHRpb24pID0+ICFvcHRpb24uaGlkZGVuKTtcbiAgICAvLyBJbXBsaWNpdCBoZWxwXG4gICAgY29uc3Qgc2hvd1Nob3J0SGVscEZsYWcgPSBjbWQuX2hhc0hlbHBPcHRpb24gJiYgY21kLl9oZWxwU2hvcnRGbGFnICYmICFjbWQuX2ZpbmRPcHRpb24oY21kLl9oZWxwU2hvcnRGbGFnKTtcbiAgICBjb25zdCBzaG93TG9uZ0hlbHBGbGFnID0gY21kLl9oYXNIZWxwT3B0aW9uICYmICFjbWQuX2ZpbmRPcHRpb24oY21kLl9oZWxwTG9uZ0ZsYWcpO1xuICAgIGlmIChzaG93U2hvcnRIZWxwRmxhZyB8fCBzaG93TG9uZ0hlbHBGbGFnKSB7XG4gICAgICBsZXQgaGVscE9wdGlvbjtcbiAgICAgIGlmICghc2hvd1Nob3J0SGVscEZsYWcpIHtcbiAgICAgICAgaGVscE9wdGlvbiA9IGNtZC5jcmVhdGVPcHRpb24oY21kLl9oZWxwTG9uZ0ZsYWcsIGNtZC5faGVscERlc2NyaXB0aW9uKTtcbiAgICAgIH0gZWxzZSBpZiAoIXNob3dMb25nSGVscEZsYWcpIHtcbiAgICAgICAgaGVscE9wdGlvbiA9IGNtZC5jcmVhdGVPcHRpb24oY21kLl9oZWxwU2hvcnRGbGFnLCBjbWQuX2hlbHBEZXNjcmlwdGlvbik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBoZWxwT3B0aW9uID0gY21kLmNyZWF0ZU9wdGlvbihjbWQuX2hlbHBGbGFncywgY21kLl9oZWxwRGVzY3JpcHRpb24pO1xuICAgICAgfVxuICAgICAgdmlzaWJsZU9wdGlvbnMucHVzaChoZWxwT3B0aW9uKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuc29ydE9wdGlvbnMpIHtcbiAgICAgIGNvbnN0IGdldFNvcnRLZXkgPSAob3B0aW9uKSA9PiB7XG4gICAgICAgIC8vIFdZU0lXWUcgZm9yIG9yZGVyIGRpc3BsYXllZCBpbiBoZWxwIHdpdGggc2hvcnQgYmVmb3JlIGxvbmcsIG5vIHNwZWNpYWwgaGFuZGxpbmcgZm9yIG5lZ2F0ZWQuXG4gICAgICAgIHJldHVybiBvcHRpb24uc2hvcnQgPyBvcHRpb24uc2hvcnQucmVwbGFjZSgvXi0vLCAnJykgOiBvcHRpb24ubG9uZy5yZXBsYWNlKC9eLS0vLCAnJyk7XG4gICAgICB9O1xuICAgICAgdmlzaWJsZU9wdGlvbnMuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICByZXR1cm4gZ2V0U29ydEtleShhKS5sb2NhbGVDb21wYXJlKGdldFNvcnRLZXkoYikpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiB2aXNpYmxlT3B0aW9ucztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYW4gYXJyYXkgb2YgdGhlIGFyZ3VtZW50cyBpZiBhbnkgaGF2ZSBhIGRlc2NyaXB0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbW1hbmR9IGNtZFxuICAgKiBAcmV0dXJucyB7QXJndW1lbnRbXX1cbiAgICovXG5cbiAgdmlzaWJsZUFyZ3VtZW50cyhjbWQpIHtcbiAgICAvLyBTaWRlIGVmZmVjdCEgQXBwbHkgdGhlIGxlZ2FjeSBkZXNjcmlwdGlvbnMgYmVmb3JlIHRoZSBhcmd1bWVudHMgYXJlIGRpc3BsYXllZC5cbiAgICBpZiAoY21kLl9hcmdzRGVzY3JpcHRpb24pIHtcbiAgICAgIGNtZC5fYXJncy5mb3JFYWNoKGFyZ3VtZW50ID0+IHtcbiAgICAgICAgYXJndW1lbnQuZGVzY3JpcHRpb24gPSBhcmd1bWVudC5kZXNjcmlwdGlvbiB8fCBjbWQuX2FyZ3NEZXNjcmlwdGlvblthcmd1bWVudC5uYW1lKCldIHx8ICcnO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlcmUgYXJlIGFueSBhcmd1bWVudHMgd2l0aCBhIGRlc2NyaXB0aW9uIHRoZW4gcmV0dXJuIGFsbCB0aGUgYXJndW1lbnRzLlxuICAgIGlmIChjbWQuX2FyZ3MuZmluZChhcmd1bWVudCA9PiBhcmd1bWVudC5kZXNjcmlwdGlvbikpIHtcbiAgICAgIHJldHVybiBjbWQuX2FyZ3M7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGNvbW1hbmQgdGVybSB0byBzaG93IGluIHRoZSBsaXN0IG9mIHN1YmNvbW1hbmRzLlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbW1hbmR9IGNtZFxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cblxuICBzdWJjb21tYW5kVGVybShjbWQpIHtcbiAgICAvLyBMZWdhY3kuIElnbm9yZXMgY3VzdG9tIHVzYWdlIHN0cmluZywgYW5kIG5lc3RlZCBjb21tYW5kcy5cbiAgICBjb25zdCBhcmdzID0gY21kLl9hcmdzLm1hcChhcmcgPT4gaHVtYW5SZWFkYWJsZUFyZ05hbWUoYXJnKSkuam9pbignICcpO1xuICAgIHJldHVybiBjbWQuX25hbWUgK1xuICAgICAgKGNtZC5fYWxpYXNlc1swXSA/ICd8JyArIGNtZC5fYWxpYXNlc1swXSA6ICcnKSArXG4gICAgICAoY21kLm9wdGlvbnMubGVuZ3RoID8gJyBbb3B0aW9uc10nIDogJycpICsgLy8gc2ltcGxpc3RpYyBjaGVjayBmb3Igbm9uLWhlbHAgb3B0aW9uXG4gICAgICAoYXJncyA/ICcgJyArIGFyZ3MgOiAnJyk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBvcHRpb24gdGVybSB0byBzaG93IGluIHRoZSBsaXN0IG9mIG9wdGlvbnMuXG4gICAqXG4gICAqIEBwYXJhbSB7T3B0aW9ufSBvcHRpb25cbiAgICogQHJldHVybnMge3N0cmluZ31cbiAgICovXG5cbiAgb3B0aW9uVGVybShvcHRpb24pIHtcbiAgICByZXR1cm4gb3B0aW9uLmZsYWdzO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgYXJndW1lbnQgdGVybSB0byBzaG93IGluIHRoZSBsaXN0IG9mIGFyZ3VtZW50cy5cbiAgICpcbiAgICogQHBhcmFtIHtBcmd1bWVudH0gYXJndW1lbnRcbiAgICogQHJldHVybnMge3N0cmluZ31cbiAgICovXG5cbiAgYXJndW1lbnRUZXJtKGFyZ3VtZW50KSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50Lm5hbWUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGxvbmdlc3QgY29tbWFuZCB0ZXJtIGxlbmd0aC5cbiAgICpcbiAgICogQHBhcmFtIHtDb21tYW5kfSBjbWRcbiAgICogQHBhcmFtIHtIZWxwfSBoZWxwZXJcbiAgICogQHJldHVybnMge251bWJlcn1cbiAgICovXG5cbiAgbG9uZ2VzdFN1YmNvbW1hbmRUZXJtTGVuZ3RoKGNtZCwgaGVscGVyKSB7XG4gICAgcmV0dXJuIGhlbHBlci52aXNpYmxlQ29tbWFuZHMoY21kKS5yZWR1Y2UoKG1heCwgY29tbWFuZCkgPT4ge1xuICAgICAgcmV0dXJuIE1hdGgubWF4KG1heCwgaGVscGVyLnN1YmNvbW1hbmRUZXJtKGNvbW1hbmQpLmxlbmd0aCk7XG4gICAgfSwgMCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBsb25nZXN0IG9wdGlvbiB0ZXJtIGxlbmd0aC5cbiAgICpcbiAgICogQHBhcmFtIHtDb21tYW5kfSBjbWRcbiAgICogQHBhcmFtIHtIZWxwfSBoZWxwZXJcbiAgICogQHJldHVybnMge251bWJlcn1cbiAgICovXG5cbiAgbG9uZ2VzdE9wdGlvblRlcm1MZW5ndGgoY21kLCBoZWxwZXIpIHtcbiAgICByZXR1cm4gaGVscGVyLnZpc2libGVPcHRpb25zKGNtZCkucmVkdWNlKChtYXgsIG9wdGlvbikgPT4ge1xuICAgICAgcmV0dXJuIE1hdGgubWF4KG1heCwgaGVscGVyLm9wdGlvblRlcm0ob3B0aW9uKS5sZW5ndGgpO1xuICAgIH0sIDApO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgbG9uZ2VzdCBhcmd1bWVudCB0ZXJtIGxlbmd0aC5cbiAgICpcbiAgICogQHBhcmFtIHtDb21tYW5kfSBjbWRcbiAgICogQHBhcmFtIHtIZWxwfSBoZWxwZXJcbiAgICogQHJldHVybnMge251bWJlcn1cbiAgICovXG5cbiAgbG9uZ2VzdEFyZ3VtZW50VGVybUxlbmd0aChjbWQsIGhlbHBlcikge1xuICAgIHJldHVybiBoZWxwZXIudmlzaWJsZUFyZ3VtZW50cyhjbWQpLnJlZHVjZSgobWF4LCBhcmd1bWVudCkgPT4ge1xuICAgICAgcmV0dXJuIE1hdGgubWF4KG1heCwgaGVscGVyLmFyZ3VtZW50VGVybShhcmd1bWVudCkubGVuZ3RoKTtcbiAgICB9LCAwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGNvbW1hbmQgdXNhZ2UgdG8gYmUgZGlzcGxheWVkIGF0IHRoZSB0b3Agb2YgdGhlIGJ1aWx0LWluIGhlbHAuXG4gICAqXG4gICAqIEBwYXJhbSB7Q29tbWFuZH0gY21kXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAqL1xuXG4gIGNvbW1hbmRVc2FnZShjbWQpIHtcbiAgICAvLyBVc2FnZVxuICAgIGxldCBjbWROYW1lID0gY21kLl9uYW1lO1xuICAgIGlmIChjbWQuX2FsaWFzZXNbMF0pIHtcbiAgICAgIGNtZE5hbWUgPSBjbWROYW1lICsgJ3wnICsgY21kLl9hbGlhc2VzWzBdO1xuICAgIH1cbiAgICBsZXQgcGFyZW50Q21kTmFtZXMgPSAnJztcbiAgICBmb3IgKGxldCBwYXJlbnRDbWQgPSBjbWQucGFyZW50OyBwYXJlbnRDbWQ7IHBhcmVudENtZCA9IHBhcmVudENtZC5wYXJlbnQpIHtcbiAgICAgIHBhcmVudENtZE5hbWVzID0gcGFyZW50Q21kLm5hbWUoKSArICcgJyArIHBhcmVudENtZE5hbWVzO1xuICAgIH1cbiAgICByZXR1cm4gcGFyZW50Q21kTmFtZXMgKyBjbWROYW1lICsgJyAnICsgY21kLnVzYWdlKCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBkZXNjcmlwdGlvbiBmb3IgdGhlIGNvbW1hbmQuXG4gICAqXG4gICAqIEBwYXJhbSB7Q29tbWFuZH0gY21kXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAqL1xuXG4gIGNvbW1hbmREZXNjcmlwdGlvbihjbWQpIHtcbiAgICAvLyBAdHMtaWdub3JlOiBvdmVybG9hZGVkIHJldHVybiB0eXBlXG4gICAgcmV0dXJuIGNtZC5kZXNjcmlwdGlvbigpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgY29tbWFuZCBkZXNjcmlwdGlvbiB0byBzaG93IGluIHRoZSBsaXN0IG9mIHN1YmNvbW1hbmRzLlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbW1hbmR9IGNtZFxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cblxuICBzdWJjb21tYW5kRGVzY3JpcHRpb24oY21kKSB7XG4gICAgLy8gQHRzLWlnbm9yZTogb3ZlcmxvYWRlZCByZXR1cm4gdHlwZVxuICAgIHJldHVybiBjbWQuZGVzY3JpcHRpb24oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIG9wdGlvbiBkZXNjcmlwdGlvbiB0byBzaG93IGluIHRoZSBsaXN0IG9mIG9wdGlvbnMuXG4gICAqXG4gICAqIEBwYXJhbSB7T3B0aW9ufSBvcHRpb25cbiAgICogQHJldHVybiB7c3RyaW5nfVxuICAgKi9cblxuICBvcHRpb25EZXNjcmlwdGlvbihvcHRpb24pIHtcbiAgICBjb25zdCBleHRyYUluZm8gPSBbXTtcblxuICAgIGlmIChvcHRpb24uYXJnQ2hvaWNlcykge1xuICAgICAgZXh0cmFJbmZvLnB1c2goXG4gICAgICAgIC8vIHVzZSBzdHJpbmdpZnkgdG8gbWF0Y2ggdGhlIGRpc3BsYXkgb2YgdGhlIGRlZmF1bHQgdmFsdWVcbiAgICAgICAgYGNob2ljZXM6ICR7b3B0aW9uLmFyZ0Nob2ljZXMubWFwKChjaG9pY2UpID0+IEpTT04uc3RyaW5naWZ5KGNob2ljZSkpLmpvaW4oJywgJyl9YCk7XG4gICAgfVxuICAgIGlmIChvcHRpb24uZGVmYXVsdFZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIGRlZmF1bHQgZm9yIGJvb2xlYW4gYW5kIG5lZ2F0ZWQgbW9yZSBmb3IgcHJvZ3JhbW1lciB0aGFuIGVuZCB1c2VyLFxuICAgICAgLy8gYnV0IHNob3cgdHJ1ZS9mYWxzZSBmb3IgYm9vbGVhbiBvcHRpb24gYXMgbWF5IGJlIGZvciBoYW5kLXJvbGxlZCBlbnYgb3IgY29uZmlnIHByb2Nlc3NpbmcuXG4gICAgICBjb25zdCBzaG93RGVmYXVsdCA9IG9wdGlvbi5yZXF1aXJlZCB8fCBvcHRpb24ub3B0aW9uYWwgfHxcbiAgICAgICAgKG9wdGlvbi5pc0Jvb2xlYW4oKSAmJiB0eXBlb2Ygb3B0aW9uLmRlZmF1bHRWYWx1ZSA9PT0gJ2Jvb2xlYW4nKTtcbiAgICAgIGlmIChzaG93RGVmYXVsdCkge1xuICAgICAgICBleHRyYUluZm8ucHVzaChgZGVmYXVsdDogJHtvcHRpb24uZGVmYXVsdFZhbHVlRGVzY3JpcHRpb24gfHwgSlNPTi5zdHJpbmdpZnkob3B0aW9uLmRlZmF1bHRWYWx1ZSl9YCk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIHByZXNldCBmb3IgYm9vbGVhbiBhbmQgbmVnYXRlZCBhcmUgbW9yZSBmb3IgcHJvZ3JhbW1lciB0aGFuIGVuZCB1c2VyXG4gICAgaWYgKG9wdGlvbi5wcmVzZXRBcmcgIT09IHVuZGVmaW5lZCAmJiBvcHRpb24ub3B0aW9uYWwpIHtcbiAgICAgIGV4dHJhSW5mby5wdXNoKGBwcmVzZXQ6ICR7SlNPTi5zdHJpbmdpZnkob3B0aW9uLnByZXNldEFyZyl9YCk7XG4gICAgfVxuICAgIGlmIChvcHRpb24uZW52VmFyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGV4dHJhSW5mby5wdXNoKGBlbnY6ICR7b3B0aW9uLmVudlZhcn1gKTtcbiAgICB9XG4gICAgaWYgKGV4dHJhSW5mby5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gYCR7b3B0aW9uLmRlc2NyaXB0aW9ufSAoJHtleHRyYUluZm8uam9pbignLCAnKX0pYDtcbiAgICB9XG5cbiAgICByZXR1cm4gb3B0aW9uLmRlc2NyaXB0aW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgYXJndW1lbnQgZGVzY3JpcHRpb24gdG8gc2hvdyBpbiB0aGUgbGlzdCBvZiBhcmd1bWVudHMuXG4gICAqXG4gICAqIEBwYXJhbSB7QXJndW1lbnR9IGFyZ3VtZW50XG4gICAqIEByZXR1cm4ge3N0cmluZ31cbiAgICovXG5cbiAgYXJndW1lbnREZXNjcmlwdGlvbihhcmd1bWVudCkge1xuICAgIGNvbnN0IGV4dHJhSW5mbyA9IFtdO1xuICAgIGlmIChhcmd1bWVudC5hcmdDaG9pY2VzKSB7XG4gICAgICBleHRyYUluZm8ucHVzaChcbiAgICAgICAgLy8gdXNlIHN0cmluZ2lmeSB0byBtYXRjaCB0aGUgZGlzcGxheSBvZiB0aGUgZGVmYXVsdCB2YWx1ZVxuICAgICAgICBgY2hvaWNlczogJHthcmd1bWVudC5hcmdDaG9pY2VzLm1hcCgoY2hvaWNlKSA9PiBKU09OLnN0cmluZ2lmeShjaG9pY2UpKS5qb2luKCcsICcpfWApO1xuICAgIH1cbiAgICBpZiAoYXJndW1lbnQuZGVmYXVsdFZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGV4dHJhSW5mby5wdXNoKGBkZWZhdWx0OiAke2FyZ3VtZW50LmRlZmF1bHRWYWx1ZURlc2NyaXB0aW9uIHx8IEpTT04uc3RyaW5naWZ5KGFyZ3VtZW50LmRlZmF1bHRWYWx1ZSl9YCk7XG4gICAgfVxuICAgIGlmIChleHRyYUluZm8ubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZXh0cmFEZXNjcmlwdG9uID0gYCgke2V4dHJhSW5mby5qb2luKCcsICcpfSlgO1xuICAgICAgaWYgKGFyZ3VtZW50LmRlc2NyaXB0aW9uKSB7XG4gICAgICAgIHJldHVybiBgJHthcmd1bWVudC5kZXNjcmlwdGlvbn0gJHtleHRyYURlc2NyaXB0b259YDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBleHRyYURlc2NyaXB0b247XG4gICAgfVxuICAgIHJldHVybiBhcmd1bWVudC5kZXNjcmlwdGlvbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZSB0aGUgYnVpbHQtaW4gaGVscCB0ZXh0LlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbW1hbmR9IGNtZFxuICAgKiBAcGFyYW0ge0hlbHB9IGhlbHBlclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cblxuICBmb3JtYXRIZWxwKGNtZCwgaGVscGVyKSB7XG4gICAgY29uc3QgdGVybVdpZHRoID0gaGVscGVyLnBhZFdpZHRoKGNtZCwgaGVscGVyKTtcbiAgICBjb25zdCBoZWxwV2lkdGggPSBoZWxwZXIuaGVscFdpZHRoIHx8IDgwO1xuICAgIGNvbnN0IGl0ZW1JbmRlbnRXaWR0aCA9IDI7XG4gICAgY29uc3QgaXRlbVNlcGFyYXRvcldpZHRoID0gMjsgLy8gYmV0d2VlbiB0ZXJtIGFuZCBkZXNjcmlwdGlvblxuICAgIGZ1bmN0aW9uIGZvcm1hdEl0ZW0odGVybSwgZGVzY3JpcHRpb24pIHtcbiAgICAgIGlmIChkZXNjcmlwdGlvbikge1xuICAgICAgICBjb25zdCBmdWxsVGV4dCA9IGAke3Rlcm0ucGFkRW5kKHRlcm1XaWR0aCArIGl0ZW1TZXBhcmF0b3JXaWR0aCl9JHtkZXNjcmlwdGlvbn1gO1xuICAgICAgICByZXR1cm4gaGVscGVyLndyYXAoZnVsbFRleHQsIGhlbHBXaWR0aCAtIGl0ZW1JbmRlbnRXaWR0aCwgdGVybVdpZHRoICsgaXRlbVNlcGFyYXRvcldpZHRoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0ZXJtO1xuICAgIH1cbiAgICBmdW5jdGlvbiBmb3JtYXRMaXN0KHRleHRBcnJheSkge1xuICAgICAgcmV0dXJuIHRleHRBcnJheS5qb2luKCdcXG4nKS5yZXBsYWNlKC9eL2dtLCAnICcucmVwZWF0KGl0ZW1JbmRlbnRXaWR0aCkpO1xuICAgIH1cblxuICAgIC8vIFVzYWdlXG4gICAgbGV0IG91dHB1dCA9IFtgVXNhZ2U6ICR7aGVscGVyLmNvbW1hbmRVc2FnZShjbWQpfWAsICcnXTtcblxuICAgIC8vIERlc2NyaXB0aW9uXG4gICAgY29uc3QgY29tbWFuZERlc2NyaXB0aW9uID0gaGVscGVyLmNvbW1hbmREZXNjcmlwdGlvbihjbWQpO1xuICAgIGlmIChjb21tYW5kRGVzY3JpcHRpb24ubGVuZ3RoID4gMCkge1xuICAgICAgb3V0cHV0ID0gb3V0cHV0LmNvbmNhdChbY29tbWFuZERlc2NyaXB0aW9uLCAnJ10pO1xuICAgIH1cblxuICAgIC8vIEFyZ3VtZW50c1xuICAgIGNvbnN0IGFyZ3VtZW50TGlzdCA9IGhlbHBlci52aXNpYmxlQXJndW1lbnRzKGNtZCkubWFwKChhcmd1bWVudCkgPT4ge1xuICAgICAgcmV0dXJuIGZvcm1hdEl0ZW0oaGVscGVyLmFyZ3VtZW50VGVybShhcmd1bWVudCksIGhlbHBlci5hcmd1bWVudERlc2NyaXB0aW9uKGFyZ3VtZW50KSk7XG4gICAgfSk7XG4gICAgaWYgKGFyZ3VtZW50TGlzdC5sZW5ndGggPiAwKSB7XG4gICAgICBvdXRwdXQgPSBvdXRwdXQuY29uY2F0KFsnQXJndW1lbnRzOicsIGZvcm1hdExpc3QoYXJndW1lbnRMaXN0KSwgJyddKTtcbiAgICB9XG5cbiAgICAvLyBPcHRpb25zXG4gICAgY29uc3Qgb3B0aW9uTGlzdCA9IGhlbHBlci52aXNpYmxlT3B0aW9ucyhjbWQpLm1hcCgob3B0aW9uKSA9PiB7XG4gICAgICByZXR1cm4gZm9ybWF0SXRlbShoZWxwZXIub3B0aW9uVGVybShvcHRpb24pLCBoZWxwZXIub3B0aW9uRGVzY3JpcHRpb24ob3B0aW9uKSk7XG4gICAgfSk7XG4gICAgaWYgKG9wdGlvbkxpc3QubGVuZ3RoID4gMCkge1xuICAgICAgb3V0cHV0ID0gb3V0cHV0LmNvbmNhdChbJ09wdGlvbnM6JywgZm9ybWF0TGlzdChvcHRpb25MaXN0KSwgJyddKTtcbiAgICB9XG5cbiAgICAvLyBDb21tYW5kc1xuICAgIGNvbnN0IGNvbW1hbmRMaXN0ID0gaGVscGVyLnZpc2libGVDb21tYW5kcyhjbWQpLm1hcCgoY21kKSA9PiB7XG4gICAgICByZXR1cm4gZm9ybWF0SXRlbShoZWxwZXIuc3ViY29tbWFuZFRlcm0oY21kKSwgaGVscGVyLnN1YmNvbW1hbmREZXNjcmlwdGlvbihjbWQpKTtcbiAgICB9KTtcbiAgICBpZiAoY29tbWFuZExpc3QubGVuZ3RoID4gMCkge1xuICAgICAgb3V0cHV0ID0gb3V0cHV0LmNvbmNhdChbJ0NvbW1hbmRzOicsIGZvcm1hdExpc3QoY29tbWFuZExpc3QpLCAnJ10pO1xuICAgIH1cblxuICAgIHJldHVybiBvdXRwdXQuam9pbignXFxuJyk7XG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIHRoZSBwYWQgd2lkdGggZnJvbSB0aGUgbWF4aW11bSB0ZXJtIGxlbmd0aC5cbiAgICpcbiAgICogQHBhcmFtIHtDb21tYW5kfSBjbWRcbiAgICogQHBhcmFtIHtIZWxwfSBoZWxwZXJcbiAgICogQHJldHVybnMge251bWJlcn1cbiAgICovXG5cbiAgcGFkV2lkdGgoY21kLCBoZWxwZXIpIHtcbiAgICByZXR1cm4gTWF0aC5tYXgoXG4gICAgICBoZWxwZXIubG9uZ2VzdE9wdGlvblRlcm1MZW5ndGgoY21kLCBoZWxwZXIpLFxuICAgICAgaGVscGVyLmxvbmdlc3RTdWJjb21tYW5kVGVybUxlbmd0aChjbWQsIGhlbHBlciksXG4gICAgICBoZWxwZXIubG9uZ2VzdEFyZ3VtZW50VGVybUxlbmd0aChjbWQsIGhlbHBlcilcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIFdyYXAgdGhlIGdpdmVuIHN0cmluZyB0byB3aWR0aCBjaGFyYWN0ZXJzIHBlciBsaW5lLCB3aXRoIGxpbmVzIGFmdGVyIHRoZSBmaXJzdCBpbmRlbnRlZC5cbiAgICogRG8gbm90IHdyYXAgaWYgaW5zdWZmaWNpZW50IHJvb20gZm9yIHdyYXBwaW5nIChtaW5Db2x1bW5XaWR0aCksIG9yIHN0cmluZyBpcyBtYW51YWxseSBmb3JtYXR0ZWQuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJcbiAgICogQHBhcmFtIHtudW1iZXJ9IHdpZHRoXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRlbnRcbiAgICogQHBhcmFtIHtudW1iZXJ9IFttaW5Db2x1bW5XaWR0aD00MF1cbiAgICogQHJldHVybiB7c3RyaW5nfVxuICAgKlxuICAgKi9cblxuICB3cmFwKHN0ciwgd2lkdGgsIGluZGVudCwgbWluQ29sdW1uV2lkdGggPSA0MCkge1xuICAgIC8vIERldGVjdCBtYW51YWxseSB3cmFwcGVkIGFuZCBpbmRlbnRlZCBzdHJpbmdzIGJ5IHNlYXJjaGluZyBmb3IgbGluZSBicmVha3NcbiAgICAvLyBmb2xsb3dlZCBieSBtdWx0aXBsZSBzcGFjZXMvdGFicy5cbiAgICBpZiAoc3RyLm1hdGNoKC9bXFxuXVxccysvKSkgcmV0dXJuIHN0cjtcbiAgICAvLyBEbyBub3Qgd3JhcCBpZiBub3QgZW5vdWdoIHJvb20gZm9yIGEgd3JhcHBlZCBjb2x1bW4gb2YgdGV4dCAoYXMgY291bGQgZW5kIHVwIHdpdGggYSB3b3JkIHBlciBsaW5lKS5cbiAgICBjb25zdCBjb2x1bW5XaWR0aCA9IHdpZHRoIC0gaW5kZW50O1xuICAgIGlmIChjb2x1bW5XaWR0aCA8IG1pbkNvbHVtbldpZHRoKSByZXR1cm4gc3RyO1xuXG4gICAgY29uc3QgbGVhZGluZ1N0ciA9IHN0ci5zbGljZSgwLCBpbmRlbnQpO1xuICAgIGNvbnN0IGNvbHVtblRleHQgPSBzdHIuc2xpY2UoaW5kZW50KTtcblxuICAgIGNvbnN0IGluZGVudFN0cmluZyA9ICcgJy5yZXBlYXQoaW5kZW50KTtcbiAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAoJy57MSwnICsgKGNvbHVtbldpZHRoIC0gMSkgKyAnfShbXFxcXHNcXHUyMDBCXXwkKXxbXlxcXFxzXFx1MjAwQl0rPyhbXFxcXHNcXHUyMDBCXXwkKScsICdnJyk7XG4gICAgY29uc3QgbGluZXMgPSBjb2x1bW5UZXh0Lm1hdGNoKHJlZ2V4KSB8fCBbXTtcbiAgICByZXR1cm4gbGVhZGluZ1N0ciArIGxpbmVzLm1hcCgobGluZSwgaSkgPT4ge1xuICAgICAgaWYgKGxpbmUuc2xpY2UoLTEpID09PSAnXFxuJykge1xuICAgICAgICBsaW5lID0gbGluZS5zbGljZSgwLCBsaW5lLmxlbmd0aCAtIDEpO1xuICAgICAgfVxuICAgICAgcmV0dXJuICgoaSA+IDApID8gaW5kZW50U3RyaW5nIDogJycpICsgbGluZS50cmltUmlnaHQoKTtcbiAgICB9KS5qb2luKCdcXG4nKTtcbiAgfVxufVxuXG5leHBvcnRzLkhlbHAgPSBIZWxwO1xuIiwiY29uc3QgeyBJbnZhbGlkQXJndW1lbnRFcnJvciB9ID0gcmVxdWlyZSgnLi9lcnJvci5qcycpO1xuXG4vLyBAdHMtY2hlY2tcblxuY2xhc3MgT3B0aW9uIHtcbiAgLyoqXG4gICAqIEluaXRpYWxpemUgYSBuZXcgYE9wdGlvbmAgd2l0aCB0aGUgZ2l2ZW4gYGZsYWdzYCBhbmQgYGRlc2NyaXB0aW9uYC5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZsYWdzXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dXG4gICAqL1xuXG4gIGNvbnN0cnVjdG9yKGZsYWdzLCBkZXNjcmlwdGlvbikge1xuICAgIHRoaXMuZmxhZ3MgPSBmbGFncztcbiAgICB0aGlzLmRlc2NyaXB0aW9uID0gZGVzY3JpcHRpb24gfHwgJyc7XG5cbiAgICB0aGlzLnJlcXVpcmVkID0gZmxhZ3MuaW5jbHVkZXMoJzwnKTsgLy8gQSB2YWx1ZSBtdXN0IGJlIHN1cHBsaWVkIHdoZW4gdGhlIG9wdGlvbiBpcyBzcGVjaWZpZWQuXG4gICAgdGhpcy5vcHRpb25hbCA9IGZsYWdzLmluY2x1ZGVzKCdbJyk7IC8vIEEgdmFsdWUgaXMgb3B0aW9uYWwgd2hlbiB0aGUgb3B0aW9uIGlzIHNwZWNpZmllZC5cbiAgICAvLyB2YXJpYWRpYyB0ZXN0IGlnbm9yZXMgPHZhbHVlLC4uLj4gZXQgYWwgd2hpY2ggbWlnaHQgYmUgdXNlZCB0byBkZXNjcmliZSBjdXN0b20gc3BsaXR0aW5nIG9mIHNpbmdsZSBhcmd1bWVudFxuICAgIHRoaXMudmFyaWFkaWMgPSAvXFx3XFwuXFwuXFwuWz5cXF1dJC8udGVzdChmbGFncyk7IC8vIFRoZSBvcHRpb24gY2FuIHRha2UgbXVsdGlwbGUgdmFsdWVzLlxuICAgIHRoaXMubWFuZGF0b3J5ID0gZmFsc2U7IC8vIFRoZSBvcHRpb24gbXVzdCBoYXZlIGEgdmFsdWUgYWZ0ZXIgcGFyc2luZywgd2hpY2ggdXN1YWxseSBtZWFucyBpdCBtdXN0IGJlIHNwZWNpZmllZCBvbiBjb21tYW5kIGxpbmUuXG4gICAgY29uc3Qgb3B0aW9uRmxhZ3MgPSBzcGxpdE9wdGlvbkZsYWdzKGZsYWdzKTtcbiAgICB0aGlzLnNob3J0ID0gb3B0aW9uRmxhZ3Muc2hvcnRGbGFnO1xuICAgIHRoaXMubG9uZyA9IG9wdGlvbkZsYWdzLmxvbmdGbGFnO1xuICAgIHRoaXMubmVnYXRlID0gZmFsc2U7XG4gICAgaWYgKHRoaXMubG9uZykge1xuICAgICAgdGhpcy5uZWdhdGUgPSB0aGlzLmxvbmcuc3RhcnRzV2l0aCgnLS1uby0nKTtcbiAgICB9XG4gICAgdGhpcy5kZWZhdWx0VmFsdWUgPSB1bmRlZmluZWQ7XG4gICAgdGhpcy5kZWZhdWx0VmFsdWVEZXNjcmlwdGlvbiA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLnByZXNldEFyZyA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLmVudlZhciA9IHVuZGVmaW5lZDtcbiAgICB0aGlzLnBhcnNlQXJnID0gdW5kZWZpbmVkO1xuICAgIHRoaXMuaGlkZGVuID0gZmFsc2U7XG4gICAgdGhpcy5hcmdDaG9pY2VzID0gdW5kZWZpbmVkO1xuICAgIHRoaXMuY29uZmxpY3RzV2l0aCA9IFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCB0aGUgZGVmYXVsdCB2YWx1ZSwgYW5kIG9wdGlvbmFsbHkgc3VwcGx5IHRoZSBkZXNjcmlwdGlvbiB0byBiZSBkaXNwbGF5ZWQgaW4gdGhlIGhlbHAuXG4gICAqXG4gICAqIEBwYXJhbSB7YW55fSB2YWx1ZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2Rlc2NyaXB0aW9uXVxuICAgKiBAcmV0dXJuIHtPcHRpb259XG4gICAqL1xuXG4gIGRlZmF1bHQodmFsdWUsIGRlc2NyaXB0aW9uKSB7XG4gICAgdGhpcy5kZWZhdWx0VmFsdWUgPSB2YWx1ZTtcbiAgICB0aGlzLmRlZmF1bHRWYWx1ZURlc2NyaXB0aW9uID0gZGVzY3JpcHRpb247XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogUHJlc2V0IHRvIHVzZSB3aGVuIG9wdGlvbiB1c2VkIHdpdGhvdXQgb3B0aW9uLWFyZ3VtZW50LCBlc3BlY2lhbGx5IG9wdGlvbmFsIGJ1dCBhbHNvIGJvb2xlYW4gYW5kIG5lZ2F0ZWQuXG4gICAqIFRoZSBjdXN0b20gcHJvY2Vzc2luZyAocGFyc2VBcmcpIGlzIGNhbGxlZC5cbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogbmV3IE9wdGlvbignLS1jb2xvcicpLmRlZmF1bHQoJ0dSRVlTQ0FMRScpLnByZXNldCgnUkdCJyk7XG4gICAqIG5ldyBPcHRpb24oJy0tZG9uYXRlIFthbW91bnRdJykucHJlc2V0KCcyMCcpLmFyZ1BhcnNlcihwYXJzZUZsb2F0KTtcbiAgICpcbiAgICogQHBhcmFtIHthbnl9IGFyZ1xuICAgKiBAcmV0dXJuIHtPcHRpb259XG4gICAqL1xuXG4gIHByZXNldChhcmcpIHtcbiAgICB0aGlzLnByZXNldEFyZyA9IGFyZztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgb3B0aW9uIG5hbWUocykgdGhhdCBjb25mbGljdCB3aXRoIHRoaXMgb3B0aW9uLlxuICAgKiBBbiBlcnJvciB3aWxsIGJlIGRpc3BsYXllZCBpZiBjb25mbGljdGluZyBvcHRpb25zIGFyZSBmb3VuZCBkdXJpbmcgcGFyc2luZy5cbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogbmV3IE9wdGlvbignLS1yZ2InKS5jb25mbGljdHMoJ2NteWsnKTtcbiAgICogbmV3IE9wdGlvbignLS1qcycpLmNvbmZsaWN0cyhbJ3RzJywgJ2pzeCddKTtcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gbmFtZXNcbiAgICogQHJldHVybiB7T3B0aW9ufVxuICAgKi9cblxuICBjb25mbGljdHMobmFtZXMpIHtcbiAgICB0aGlzLmNvbmZsaWN0c1dpdGggPSB0aGlzLmNvbmZsaWN0c1dpdGguY29uY2F0KG5hbWVzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGUgdG8gY2hlY2sgZm9yIG9wdGlvbiB2YWx1ZS5cbiAgICogUHJpb3JpdHkgb3JkZXIgb2Ygb3B0aW9uIHZhbHVlcyBpcyBkZWZhdWx0IDwgZW52IDwgY2xpXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lXG4gICAqIEByZXR1cm4ge09wdGlvbn1cbiAgICovXG5cbiAgZW52KG5hbWUpIHtcbiAgICB0aGlzLmVudlZhciA9IG5hbWU7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHRoZSBjdXN0b20gaGFuZGxlciBmb3IgcHJvY2Vzc2luZyBDTEkgb3B0aW9uIGFyZ3VtZW50cyBpbnRvIG9wdGlvbiB2YWx1ZXMuXG4gICAqXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IFtmbl1cbiAgICogQHJldHVybiB7T3B0aW9ufVxuICAgKi9cblxuICBhcmdQYXJzZXIoZm4pIHtcbiAgICB0aGlzLnBhcnNlQXJnID0gZm47XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgb3B0aW9uIGlzIG1hbmRhdG9yeSBhbmQgbXVzdCBoYXZlIGEgdmFsdWUgYWZ0ZXIgcGFyc2luZy5cbiAgICpcbiAgICogQHBhcmFtIHtib29sZWFufSBbbWFuZGF0b3J5PXRydWVdXG4gICAqIEByZXR1cm4ge09wdGlvbn1cbiAgICovXG5cbiAgbWFrZU9wdGlvbk1hbmRhdG9yeShtYW5kYXRvcnkgPSB0cnVlKSB7XG4gICAgdGhpcy5tYW5kYXRvcnkgPSAhIW1hbmRhdG9yeTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBIaWRlIG9wdGlvbiBpbiBoZWxwLlxuICAgKlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFtoaWRlPXRydWVdXG4gICAqIEByZXR1cm4ge09wdGlvbn1cbiAgICovXG5cbiAgaGlkZUhlbHAoaGlkZSA9IHRydWUpIHtcbiAgICB0aGlzLmhpZGRlbiA9ICEhaGlkZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgX2NvbmNhdFZhbHVlKHZhbHVlLCBwcmV2aW91cykge1xuICAgIGlmIChwcmV2aW91cyA9PT0gdGhpcy5kZWZhdWx0VmFsdWUgfHwgIUFycmF5LmlzQXJyYXkocHJldmlvdXMpKSB7XG4gICAgICByZXR1cm4gW3ZhbHVlXTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJldmlvdXMuY29uY2F0KHZhbHVlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBPbmx5IGFsbG93IG9wdGlvbiB2YWx1ZSB0byBiZSBvbmUgb2YgY2hvaWNlcy5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdmFsdWVzXG4gICAqIEByZXR1cm4ge09wdGlvbn1cbiAgICovXG5cbiAgY2hvaWNlcyh2YWx1ZXMpIHtcbiAgICB0aGlzLmFyZ0Nob2ljZXMgPSB2YWx1ZXMuc2xpY2UoKTtcbiAgICB0aGlzLnBhcnNlQXJnID0gKGFyZywgcHJldmlvdXMpID0+IHtcbiAgICAgIGlmICghdGhpcy5hcmdDaG9pY2VzLmluY2x1ZGVzKGFyZykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRBcmd1bWVudEVycm9yKGBBbGxvd2VkIGNob2ljZXMgYXJlICR7dGhpcy5hcmdDaG9pY2VzLmpvaW4oJywgJyl9LmApO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMudmFyaWFkaWMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbmNhdFZhbHVlKGFyZywgcHJldmlvdXMpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGFyZztcbiAgICB9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBvcHRpb24gbmFtZS5cbiAgICpcbiAgICogQHJldHVybiB7c3RyaW5nfVxuICAgKi9cblxuICBuYW1lKCkge1xuICAgIGlmICh0aGlzLmxvbmcpIHtcbiAgICAgIHJldHVybiB0aGlzLmxvbmcucmVwbGFjZSgvXi0tLywgJycpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5zaG9ydC5yZXBsYWNlKC9eLS8sICcnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gb3B0aW9uIG5hbWUsIGluIGEgY2FtZWxjYXNlIGZvcm1hdCB0aGF0IGNhbiBiZSB1c2VkXG4gICAqIGFzIGEgb2JqZWN0IGF0dHJpYnV0ZSBrZXkuXG4gICAqXG4gICAqIEByZXR1cm4ge3N0cmluZ31cbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIGF0dHJpYnV0ZU5hbWUoKSB7XG4gICAgcmV0dXJuIGNhbWVsY2FzZSh0aGlzLm5hbWUoKS5yZXBsYWNlKC9ebm8tLywgJycpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiBgYXJnYCBtYXRjaGVzIHRoZSBzaG9ydCBvciBsb25nIGZsYWcuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdcbiAgICogQHJldHVybiB7Ym9vbGVhbn1cbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIGlzKGFyZykge1xuICAgIHJldHVybiB0aGlzLnNob3J0ID09PSBhcmcgfHwgdGhpcy5sb25nID09PSBhcmc7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHdoZXRoZXIgYSBib29sZWFuIG9wdGlvbi5cbiAgICpcbiAgICogT3B0aW9ucyBhcmUgb25lIG9mIGJvb2xlYW4sIG5lZ2F0ZWQsIHJlcXVpcmVkIGFyZ3VtZW50LCBvciBvcHRpb25hbCBhcmd1bWVudC5cbiAgICpcbiAgICogQHJldHVybiB7Ym9vbGVhbn1cbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIGlzQm9vbGVhbigpIHtcbiAgICByZXR1cm4gIXRoaXMucmVxdWlyZWQgJiYgIXRoaXMub3B0aW9uYWwgJiYgIXRoaXMubmVnYXRlO1xuICB9XG59XG5cbi8qKlxuICogQ29udmVydCBzdHJpbmcgZnJvbSBrZWJhYi1jYXNlIHRvIGNhbWVsQ2FzZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtzdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBjYW1lbGNhc2Uoc3RyKSB7XG4gIHJldHVybiBzdHIuc3BsaXQoJy0nKS5yZWR1Y2UoKHN0ciwgd29yZCkgPT4ge1xuICAgIHJldHVybiBzdHIgKyB3b3JkWzBdLnRvVXBwZXJDYXNlKCkgKyB3b3JkLnNsaWNlKDEpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBTcGxpdCB0aGUgc2hvcnQgYW5kIGxvbmcgZmxhZyBvdXQgb2Ygc29tZXRoaW5nIGxpa2UgJy1tLC0tbWl4ZWQgPHZhbHVlPidcbiAqXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzcGxpdE9wdGlvbkZsYWdzKGZsYWdzKSB7XG4gIGxldCBzaG9ydEZsYWc7XG4gIGxldCBsb25nRmxhZztcbiAgLy8gVXNlIG9yaWdpbmFsIHZlcnkgbG9vc2UgcGFyc2luZyB0byBtYWludGFpbiBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSBmb3Igbm93LFxuICAvLyB3aGljaCBhbGxvd2VkIGZvciBleGFtcGxlIHVuaW50ZW5kZWQgYC1zdywgLS1zaG9ydC13b3JkYCBbc2ljXS5cbiAgY29uc3QgZmxhZ1BhcnRzID0gZmxhZ3Muc3BsaXQoL1sgfCxdKy8pO1xuICBpZiAoZmxhZ1BhcnRzLmxlbmd0aCA+IDEgJiYgIS9eW1s8XS8udGVzdChmbGFnUGFydHNbMV0pKSBzaG9ydEZsYWcgPSBmbGFnUGFydHMuc2hpZnQoKTtcbiAgbG9uZ0ZsYWcgPSBmbGFnUGFydHMuc2hpZnQoKTtcbiAgLy8gQWRkIHN1cHBvcnQgZm9yIGxvbmUgc2hvcnQgZmxhZyB3aXRob3V0IHNpZ25pZmljYW50bHkgY2hhbmdpbmcgcGFyc2luZyFcbiAgaWYgKCFzaG9ydEZsYWcgJiYgL14tW14tXSQvLnRlc3QobG9uZ0ZsYWcpKSB7XG4gICAgc2hvcnRGbGFnID0gbG9uZ0ZsYWc7XG4gICAgbG9uZ0ZsYWcgPSB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIHsgc2hvcnRGbGFnLCBsb25nRmxhZyB9O1xufVxuXG5leHBvcnRzLk9wdGlvbiA9IE9wdGlvbjtcbmV4cG9ydHMuc3BsaXRPcHRpb25GbGFncyA9IHNwbGl0T3B0aW9uRmxhZ3M7XG4iLCJjb25zdCBtYXhEaXN0YW5jZSA9IDM7XG5cbmZ1bmN0aW9uIGVkaXREaXN0YW5jZShhLCBiKSB7XG4gIC8vIGh0dHBzOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0RhbWVyYXXigJNMZXZlbnNodGVpbl9kaXN0YW5jZVxuICAvLyBDYWxjdWxhdGluZyBvcHRpbWFsIHN0cmluZyBhbGlnbm1lbnQgZGlzdGFuY2UsIG5vIHN1YnN0cmluZyBpcyBlZGl0ZWQgbW9yZSB0aGFuIG9uY2UuXG4gIC8vIChTaW1wbGUgaW1wbGVtZW50YXRpb24uKVxuXG4gIC8vIFF1aWNrIGVhcmx5IGV4aXQsIHJldHVybiB3b3JzdCBjYXNlLlxuICBpZiAoTWF0aC5hYnMoYS5sZW5ndGggLSBiLmxlbmd0aCkgPiBtYXhEaXN0YW5jZSkgcmV0dXJuIE1hdGgubWF4KGEubGVuZ3RoLCBiLmxlbmd0aCk7XG5cbiAgLy8gZGlzdGFuY2UgYmV0d2VlbiBwcmVmaXggc3Vic3RyaW5ncyBvZiBhIGFuZCBiXG4gIGNvbnN0IGQgPSBbXTtcblxuICAvLyBwdXJlIGRlbGV0aW9ucyB0dXJuIGEgaW50byBlbXB0eSBzdHJpbmdcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gYS5sZW5ndGg7IGkrKykge1xuICAgIGRbaV0gPSBbaV07XG4gIH1cbiAgLy8gcHVyZSBpbnNlcnRpb25zIHR1cm4gZW1wdHkgc3RyaW5nIGludG8gYlxuICBmb3IgKGxldCBqID0gMDsgaiA8PSBiLmxlbmd0aDsgaisrKSB7XG4gICAgZFswXVtqXSA9IGo7XG4gIH1cblxuICAvLyBmaWxsIG1hdHJpeFxuICBmb3IgKGxldCBqID0gMTsgaiA8PSBiLmxlbmd0aDsgaisrKSB7XG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPD0gYS5sZW5ndGg7IGkrKykge1xuICAgICAgbGV0IGNvc3QgPSAxO1xuICAgICAgaWYgKGFbaSAtIDFdID09PSBiW2ogLSAxXSkge1xuICAgICAgICBjb3N0ID0gMDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvc3QgPSAxO1xuICAgICAgfVxuICAgICAgZFtpXVtqXSA9IE1hdGgubWluKFxuICAgICAgICBkW2kgLSAxXVtqXSArIDEsIC8vIGRlbGV0aW9uXG4gICAgICAgIGRbaV1baiAtIDFdICsgMSwgLy8gaW5zZXJ0aW9uXG4gICAgICAgIGRbaSAtIDFdW2ogLSAxXSArIGNvc3QgLy8gc3Vic3RpdHV0aW9uXG4gICAgICApO1xuICAgICAgLy8gdHJhbnNwb3NpdGlvblxuICAgICAgaWYgKGkgPiAxICYmIGogPiAxICYmIGFbaSAtIDFdID09PSBiW2ogLSAyXSAmJiBhW2kgLSAyXSA9PT0gYltqIC0gMV0pIHtcbiAgICAgICAgZFtpXVtqXSA9IE1hdGgubWluKGRbaV1bal0sIGRbaSAtIDJdW2ogLSAyXSArIDEpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkW2EubGVuZ3RoXVtiLmxlbmd0aF07XG59XG5cbi8qKlxuICogRmluZCBjbG9zZSBtYXRjaGVzLCByZXN0cmljdGVkIHRvIHNhbWUgbnVtYmVyIG9mIGVkaXRzLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB3b3JkXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBjYW5kaWRhdGVzXG4gKiBAcmV0dXJucyB7c3RyaW5nfVxuICovXG5cbmZ1bmN0aW9uIHN1Z2dlc3RTaW1pbGFyKHdvcmQsIGNhbmRpZGF0ZXMpIHtcbiAgaWYgKCFjYW5kaWRhdGVzIHx8IGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSByZXR1cm4gJyc7XG4gIC8vIHJlbW92ZSBwb3NzaWJsZSBkdXBsaWNhdGVzXG4gIGNhbmRpZGF0ZXMgPSBBcnJheS5mcm9tKG5ldyBTZXQoY2FuZGlkYXRlcykpO1xuXG4gIGNvbnN0IHNlYXJjaGluZ09wdGlvbnMgPSB3b3JkLnN0YXJ0c1dpdGgoJy0tJyk7XG4gIGlmIChzZWFyY2hpbmdPcHRpb25zKSB7XG4gICAgd29yZCA9IHdvcmQuc2xpY2UoMik7XG4gICAgY2FuZGlkYXRlcyA9IGNhbmRpZGF0ZXMubWFwKGNhbmRpZGF0ZSA9PiBjYW5kaWRhdGUuc2xpY2UoMikpO1xuICB9XG5cbiAgbGV0IHNpbWlsYXIgPSBbXTtcbiAgbGV0IGJlc3REaXN0YW5jZSA9IG1heERpc3RhbmNlO1xuICBjb25zdCBtaW5TaW1pbGFyaXR5ID0gMC40O1xuICBjYW5kaWRhdGVzLmZvckVhY2goKGNhbmRpZGF0ZSkgPT4ge1xuICAgIGlmIChjYW5kaWRhdGUubGVuZ3RoIDw9IDEpIHJldHVybjsgLy8gbm8gb25lIGNoYXJhY3RlciBndWVzc2VzXG5cbiAgICBjb25zdCBkaXN0YW5jZSA9IGVkaXREaXN0YW5jZSh3b3JkLCBjYW5kaWRhdGUpO1xuICAgIGNvbnN0IGxlbmd0aCA9IE1hdGgubWF4KHdvcmQubGVuZ3RoLCBjYW5kaWRhdGUubGVuZ3RoKTtcbiAgICBjb25zdCBzaW1pbGFyaXR5ID0gKGxlbmd0aCAtIGRpc3RhbmNlKSAvIGxlbmd0aDtcbiAgICBpZiAoc2ltaWxhcml0eSA+IG1pblNpbWlsYXJpdHkpIHtcbiAgICAgIGlmIChkaXN0YW5jZSA8IGJlc3REaXN0YW5jZSkge1xuICAgICAgICAvLyBiZXR0ZXIgZWRpdCBkaXN0YW5jZSwgdGhyb3cgYXdheSBwcmV2aW91cyB3b3JzZSBtYXRjaGVzXG4gICAgICAgIGJlc3REaXN0YW5jZSA9IGRpc3RhbmNlO1xuICAgICAgICBzaW1pbGFyID0gW2NhbmRpZGF0ZV07XG4gICAgICB9IGVsc2UgaWYgKGRpc3RhbmNlID09PSBiZXN0RGlzdGFuY2UpIHtcbiAgICAgICAgc2ltaWxhci5wdXNoKGNhbmRpZGF0ZSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICBzaW1pbGFyLnNvcnQoKGEsIGIpID0+IGEubG9jYWxlQ29tcGFyZShiKSk7XG4gIGlmIChzZWFyY2hpbmdPcHRpb25zKSB7XG4gICAgc2ltaWxhciA9IHNpbWlsYXIubWFwKGNhbmRpZGF0ZSA9PiBgLS0ke2NhbmRpZGF0ZX1gKTtcbiAgfVxuXG4gIGlmIChzaW1pbGFyLmxlbmd0aCA+IDEpIHtcbiAgICByZXR1cm4gYFxcbihEaWQgeW91IG1lYW4gb25lIG9mICR7c2ltaWxhci5qb2luKCcsICcpfT8pYDtcbiAgfVxuICBpZiAoc2ltaWxhci5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gYFxcbihEaWQgeW91IG1lYW4gJHtzaW1pbGFyWzBdfT8pYDtcbiAgfVxuICByZXR1cm4gJyc7XG59XG5cbmV4cG9ydHMuc3VnZ2VzdFNpbWlsYXIgPSBzdWdnZXN0U2ltaWxhcjtcbiIsImNvbnN0IEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcbmNvbnN0IGNoaWxkUHJvY2VzcyA9IHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKTtcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBwcm9jZXNzID0gcmVxdWlyZSgncHJvY2VzcycpO1xuXG5jb25zdCB7IEFyZ3VtZW50LCBodW1hblJlYWRhYmxlQXJnTmFtZSB9ID0gcmVxdWlyZSgnLi9hcmd1bWVudC5qcycpO1xuY29uc3QgeyBDb21tYW5kZXJFcnJvciB9ID0gcmVxdWlyZSgnLi9lcnJvci5qcycpO1xuY29uc3QgeyBIZWxwIH0gPSByZXF1aXJlKCcuL2hlbHAuanMnKTtcbmNvbnN0IHsgT3B0aW9uLCBzcGxpdE9wdGlvbkZsYWdzIH0gPSByZXF1aXJlKCcuL29wdGlvbi5qcycpO1xuY29uc3QgeyBzdWdnZXN0U2ltaWxhciB9ID0gcmVxdWlyZSgnLi9zdWdnZXN0U2ltaWxhcicpO1xuXG4vLyBAdHMtY2hlY2tcblxuY2xhc3MgQ29tbWFuZCBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGEgbmV3IGBDb21tYW5kYC5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtuYW1lXVxuICAgKi9cblxuICBjb25zdHJ1Y3RvcihuYW1lKSB7XG4gICAgc3VwZXIoKTtcbiAgICAvKiogQHR5cGUge0NvbW1hbmRbXX0gKi9cbiAgICB0aGlzLmNvbW1hbmRzID0gW107XG4gICAgLyoqIEB0eXBlIHtPcHRpb25bXX0gKi9cbiAgICB0aGlzLm9wdGlvbnMgPSBbXTtcbiAgICB0aGlzLnBhcmVudCA9IG51bGw7XG4gICAgdGhpcy5fYWxsb3dVbmtub3duT3B0aW9uID0gZmFsc2U7XG4gICAgdGhpcy5fYWxsb3dFeGNlc3NBcmd1bWVudHMgPSB0cnVlO1xuICAgIC8qKiBAdHlwZSB7QXJndW1lbnRbXX0gKi9cbiAgICB0aGlzLl9hcmdzID0gW107XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICB0aGlzLmFyZ3MgPSBbXTsgLy8gY2xpIGFyZ3Mgd2l0aCBvcHRpb25zIHJlbW92ZWRcbiAgICB0aGlzLnJhd0FyZ3MgPSBbXTtcbiAgICB0aGlzLnByb2Nlc3NlZEFyZ3MgPSBbXTsgLy8gbGlrZSAuYXJncyBidXQgYWZ0ZXIgY3VzdG9tIHByb2Nlc3NpbmcgYW5kIGNvbGxlY3RpbmcgdmFyaWFkaWNcbiAgICB0aGlzLl9zY3JpcHRQYXRoID0gbnVsbDtcbiAgICB0aGlzLl9uYW1lID0gbmFtZSB8fCAnJztcbiAgICB0aGlzLl9vcHRpb25WYWx1ZXMgPSB7fTtcbiAgICB0aGlzLl9vcHRpb25WYWx1ZVNvdXJjZXMgPSB7fTsgLy8gZGVmYXVsdCA8IGNvbmZpZyA8IGVudiA8IGNsaVxuICAgIHRoaXMuX3N0b3JlT3B0aW9uc0FzUHJvcGVydGllcyA9IGZhbHNlO1xuICAgIHRoaXMuX2FjdGlvbkhhbmRsZXIgPSBudWxsO1xuICAgIHRoaXMuX2V4ZWN1dGFibGVIYW5kbGVyID0gZmFsc2U7XG4gICAgdGhpcy5fZXhlY3V0YWJsZUZpbGUgPSBudWxsOyAvLyBjdXN0b20gbmFtZSBmb3IgZXhlY3V0YWJsZVxuICAgIHRoaXMuX2V4ZWN1dGFibGVEaXIgPSBudWxsOyAvLyBjdXN0b20gc2VhcmNoIGRpcmVjdG9yeSBmb3Igc3ViY29tbWFuZHNcbiAgICB0aGlzLl9kZWZhdWx0Q29tbWFuZE5hbWUgPSBudWxsO1xuICAgIHRoaXMuX2V4aXRDYWxsYmFjayA9IG51bGw7XG4gICAgdGhpcy5fYWxpYXNlcyA9IFtdO1xuICAgIHRoaXMuX2NvbWJpbmVGbGFnQW5kT3B0aW9uYWxWYWx1ZSA9IHRydWU7XG4gICAgdGhpcy5fZGVzY3JpcHRpb24gPSAnJztcbiAgICB0aGlzLl9hcmdzRGVzY3JpcHRpb24gPSB1bmRlZmluZWQ7IC8vIGxlZ2FjeVxuICAgIHRoaXMuX2VuYWJsZVBvc2l0aW9uYWxPcHRpb25zID0gZmFsc2U7XG4gICAgdGhpcy5fcGFzc1Rocm91Z2hPcHRpb25zID0gZmFsc2U7XG4gICAgdGhpcy5fbGlmZUN5Y2xlSG9va3MgPSB7fTsgLy8gYSBoYXNoIG9mIGFycmF5c1xuICAgIC8qKiBAdHlwZSB7Ym9vbGVhbiB8IHN0cmluZ30gKi9cbiAgICB0aGlzLl9zaG93SGVscEFmdGVyRXJyb3IgPSBmYWxzZTtcbiAgICB0aGlzLl9zaG93U3VnZ2VzdGlvbkFmdGVyRXJyb3IgPSB0cnVlO1xuXG4gICAgLy8gc2VlIC5jb25maWd1cmVPdXRwdXQoKSBmb3IgZG9jc1xuICAgIHRoaXMuX291dHB1dENvbmZpZ3VyYXRpb24gPSB7XG4gICAgICB3cml0ZU91dDogKHN0cikgPT4gcHJvY2Vzcy5zdGRvdXQud3JpdGUoc3RyKSxcbiAgICAgIHdyaXRlRXJyOiAoc3RyKSA9PiBwcm9jZXNzLnN0ZGVyci53cml0ZShzdHIpLFxuICAgICAgZ2V0T3V0SGVscFdpZHRoOiAoKSA9PiBwcm9jZXNzLnN0ZG91dC5pc1RUWSA/IHByb2Nlc3Muc3Rkb3V0LmNvbHVtbnMgOiB1bmRlZmluZWQsXG4gICAgICBnZXRFcnJIZWxwV2lkdGg6ICgpID0+IHByb2Nlc3Muc3RkZXJyLmlzVFRZID8gcHJvY2Vzcy5zdGRlcnIuY29sdW1ucyA6IHVuZGVmaW5lZCxcbiAgICAgIG91dHB1dEVycm9yOiAoc3RyLCB3cml0ZSkgPT4gd3JpdGUoc3RyKVxuICAgIH07XG5cbiAgICB0aGlzLl9oaWRkZW4gPSBmYWxzZTtcbiAgICB0aGlzLl9oYXNIZWxwT3B0aW9uID0gdHJ1ZTtcbiAgICB0aGlzLl9oZWxwRmxhZ3MgPSAnLWgsIC0taGVscCc7XG4gICAgdGhpcy5faGVscERlc2NyaXB0aW9uID0gJ2Rpc3BsYXkgaGVscCBmb3IgY29tbWFuZCc7XG4gICAgdGhpcy5faGVscFNob3J0RmxhZyA9ICctaCc7XG4gICAgdGhpcy5faGVscExvbmdGbGFnID0gJy0taGVscCc7XG4gICAgdGhpcy5fYWRkSW1wbGljaXRIZWxwQ29tbWFuZCA9IHVuZGVmaW5lZDsgLy8gRGVsaWJlcmF0ZWx5IHVuZGVmaW5lZCwgbm90IGRlY2lkZWQgd2hldGhlciB0cnVlIG9yIGZhbHNlXG4gICAgdGhpcy5faGVscENvbW1hbmROYW1lID0gJ2hlbHAnO1xuICAgIHRoaXMuX2hlbHBDb21tYW5kbmFtZUFuZEFyZ3MgPSAnaGVscCBbY29tbWFuZF0nO1xuICAgIHRoaXMuX2hlbHBDb21tYW5kRGVzY3JpcHRpb24gPSAnZGlzcGxheSBoZWxwIGZvciBjb21tYW5kJztcbiAgICB0aGlzLl9oZWxwQ29uZmlndXJhdGlvbiA9IHt9O1xuICB9XG5cbiAgLyoqXG4gICAqIENvcHkgc2V0dGluZ3MgdGhhdCBhcmUgdXNlZnVsIHRvIGhhdmUgaW4gY29tbW9uIGFjcm9zcyByb290IGNvbW1hbmQgYW5kIHN1YmNvbW1hbmRzLlxuICAgKlxuICAgKiAoVXNlZCBpbnRlcm5hbGx5IHdoZW4gYWRkaW5nIGEgY29tbWFuZCB1c2luZyBgLmNvbW1hbmQoKWAgc28gc3ViY29tbWFuZHMgaW5oZXJpdCBwYXJlbnQgc2V0dGluZ3MuKVxuICAgKlxuICAgKiBAcGFyYW0ge0NvbW1hbmR9IHNvdXJjZUNvbW1hbmRcbiAgICogQHJldHVybiB7Q29tbWFuZH0gYHRoaXNgIGNvbW1hbmQgZm9yIGNoYWluaW5nXG4gICAqL1xuICBjb3B5SW5oZXJpdGVkU2V0dGluZ3Moc291cmNlQ29tbWFuZCkge1xuICAgIHRoaXMuX291dHB1dENvbmZpZ3VyYXRpb24gPSBzb3VyY2VDb21tYW5kLl9vdXRwdXRDb25maWd1cmF0aW9uO1xuICAgIHRoaXMuX2hhc0hlbHBPcHRpb24gPSBzb3VyY2VDb21tYW5kLl9oYXNIZWxwT3B0aW9uO1xuICAgIHRoaXMuX2hlbHBGbGFncyA9IHNvdXJjZUNvbW1hbmQuX2hlbHBGbGFncztcbiAgICB0aGlzLl9oZWxwRGVzY3JpcHRpb24gPSBzb3VyY2VDb21tYW5kLl9oZWxwRGVzY3JpcHRpb247XG4gICAgdGhpcy5faGVscFNob3J0RmxhZyA9IHNvdXJjZUNvbW1hbmQuX2hlbHBTaG9ydEZsYWc7XG4gICAgdGhpcy5faGVscExvbmdGbGFnID0gc291cmNlQ29tbWFuZC5faGVscExvbmdGbGFnO1xuICAgIHRoaXMuX2hlbHBDb21tYW5kTmFtZSA9IHNvdXJjZUNvbW1hbmQuX2hlbHBDb21tYW5kTmFtZTtcbiAgICB0aGlzLl9oZWxwQ29tbWFuZG5hbWVBbmRBcmdzID0gc291cmNlQ29tbWFuZC5faGVscENvbW1hbmRuYW1lQW5kQXJncztcbiAgICB0aGlzLl9oZWxwQ29tbWFuZERlc2NyaXB0aW9uID0gc291cmNlQ29tbWFuZC5faGVscENvbW1hbmREZXNjcmlwdGlvbjtcbiAgICB0aGlzLl9oZWxwQ29uZmlndXJhdGlvbiA9IHNvdXJjZUNvbW1hbmQuX2hlbHBDb25maWd1cmF0aW9uO1xuICAgIHRoaXMuX2V4aXRDYWxsYmFjayA9IHNvdXJjZUNvbW1hbmQuX2V4aXRDYWxsYmFjaztcbiAgICB0aGlzLl9zdG9yZU9wdGlvbnNBc1Byb3BlcnRpZXMgPSBzb3VyY2VDb21tYW5kLl9zdG9yZU9wdGlvbnNBc1Byb3BlcnRpZXM7XG4gICAgdGhpcy5fY29tYmluZUZsYWdBbmRPcHRpb25hbFZhbHVlID0gc291cmNlQ29tbWFuZC5fY29tYmluZUZsYWdBbmRPcHRpb25hbFZhbHVlO1xuICAgIHRoaXMuX2FsbG93RXhjZXNzQXJndW1lbnRzID0gc291cmNlQ29tbWFuZC5fYWxsb3dFeGNlc3NBcmd1bWVudHM7XG4gICAgdGhpcy5fZW5hYmxlUG9zaXRpb25hbE9wdGlvbnMgPSBzb3VyY2VDb21tYW5kLl9lbmFibGVQb3NpdGlvbmFsT3B0aW9ucztcbiAgICB0aGlzLl9zaG93SGVscEFmdGVyRXJyb3IgPSBzb3VyY2VDb21tYW5kLl9zaG93SGVscEFmdGVyRXJyb3I7XG4gICAgdGhpcy5fc2hvd1N1Z2dlc3Rpb25BZnRlckVycm9yID0gc291cmNlQ29tbWFuZC5fc2hvd1N1Z2dlc3Rpb25BZnRlckVycm9yO1xuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lIGEgY29tbWFuZC5cbiAgICpcbiAgICogVGhlcmUgYXJlIHR3byBzdHlsZXMgb2YgY29tbWFuZDogcGF5IGF0dGVudGlvbiB0byB3aGVyZSB0byBwdXQgdGhlIGRlc2NyaXB0aW9uLlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiAvLyBDb21tYW5kIGltcGxlbWVudGVkIHVzaW5nIGFjdGlvbiBoYW5kbGVyIChkZXNjcmlwdGlvbiBpcyBzdXBwbGllZCBzZXBhcmF0ZWx5IHRvIGAuY29tbWFuZGApXG4gICAqIHByb2dyYW1cbiAgICogICAuY29tbWFuZCgnY2xvbmUgPHNvdXJjZT4gW2Rlc3RpbmF0aW9uXScpXG4gICAqICAgLmRlc2NyaXB0aW9uKCdjbG9uZSBhIHJlcG9zaXRvcnkgaW50byBhIG5ld2x5IGNyZWF0ZWQgZGlyZWN0b3J5JylcbiAgICogICAuYWN0aW9uKChzb3VyY2UsIGRlc3RpbmF0aW9uKSA9PiB7XG4gICAqICAgICBjb25zb2xlLmxvZygnY2xvbmUgY29tbWFuZCBjYWxsZWQnKTtcbiAgICogICB9KTtcbiAgICpcbiAgICogLy8gQ29tbWFuZCBpbXBsZW1lbnRlZCB1c2luZyBzZXBhcmF0ZSBleGVjdXRhYmxlIGZpbGUgKGRlc2NyaXB0aW9uIGlzIHNlY29uZCBwYXJhbWV0ZXIgdG8gYC5jb21tYW5kYClcbiAgICogcHJvZ3JhbVxuICAgKiAgIC5jb21tYW5kKCdzdGFydCA8c2VydmljZT4nLCAnc3RhcnQgbmFtZWQgc2VydmljZScpXG4gICAqICAgLmNvbW1hbmQoJ3N0b3AgW3NlcnZpY2VdJywgJ3N0b3AgbmFtZWQgc2VydmljZSwgb3IgYWxsIGlmIG5vIG5hbWUgc3VwcGxpZWQnKTtcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVBbmRBcmdzIC0gY29tbWFuZCBuYW1lIGFuZCBhcmd1bWVudHMsIGFyZ3MgYXJlIGA8cmVxdWlyZWQ+YCBvciBgW29wdGlvbmFsXWAgYW5kIGxhc3QgbWF5IGFsc28gYmUgYHZhcmlhZGljLi4uYFxuICAgKiBAcGFyYW0ge09iamVjdHxzdHJpbmd9IFthY3Rpb25PcHRzT3JFeGVjRGVzY10gLSBjb25maWd1cmF0aW9uIG9wdGlvbnMgKGZvciBhY3Rpb24pLCBvciBkZXNjcmlwdGlvbiAoZm9yIGV4ZWN1dGFibGUpXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbZXhlY09wdHNdIC0gY29uZmlndXJhdGlvbiBvcHRpb25zIChmb3IgZXhlY3V0YWJsZSlcbiAgICogQHJldHVybiB7Q29tbWFuZH0gcmV0dXJucyBuZXcgY29tbWFuZCBmb3IgYWN0aW9uIGhhbmRsZXIsIG9yIGB0aGlzYCBmb3IgZXhlY3V0YWJsZSBjb21tYW5kXG4gICAqL1xuXG4gIGNvbW1hbmQobmFtZUFuZEFyZ3MsIGFjdGlvbk9wdHNPckV4ZWNEZXNjLCBleGVjT3B0cykge1xuICAgIGxldCBkZXNjID0gYWN0aW9uT3B0c09yRXhlY0Rlc2M7XG4gICAgbGV0IG9wdHMgPSBleGVjT3B0cztcbiAgICBpZiAodHlwZW9mIGRlc2MgPT09ICdvYmplY3QnICYmIGRlc2MgIT09IG51bGwpIHtcbiAgICAgIG9wdHMgPSBkZXNjO1xuICAgICAgZGVzYyA9IG51bGw7XG4gICAgfVxuICAgIG9wdHMgPSBvcHRzIHx8IHt9O1xuICAgIGNvbnN0IFssIG5hbWUsIGFyZ3NdID0gbmFtZUFuZEFyZ3MubWF0Y2goLyhbXiBdKykgKiguKikvKTtcblxuICAgIGNvbnN0IGNtZCA9IHRoaXMuY3JlYXRlQ29tbWFuZChuYW1lKTtcbiAgICBpZiAoZGVzYykge1xuICAgICAgY21kLmRlc2NyaXB0aW9uKGRlc2MpO1xuICAgICAgY21kLl9leGVjdXRhYmxlSGFuZGxlciA9IHRydWU7XG4gICAgfVxuICAgIGlmIChvcHRzLmlzRGVmYXVsdCkgdGhpcy5fZGVmYXVsdENvbW1hbmROYW1lID0gY21kLl9uYW1lO1xuICAgIGNtZC5faGlkZGVuID0gISEob3B0cy5ub0hlbHAgfHwgb3B0cy5oaWRkZW4pOyAvLyBub0hlbHAgaXMgZGVwcmVjYXRlZCBvbGQgbmFtZSBmb3IgaGlkZGVuXG4gICAgY21kLl9leGVjdXRhYmxlRmlsZSA9IG9wdHMuZXhlY3V0YWJsZUZpbGUgfHwgbnVsbDsgLy8gQ3VzdG9tIG5hbWUgZm9yIGV4ZWN1dGFibGUgZmlsZSwgc2V0IG1pc3NpbmcgdG8gbnVsbCB0byBtYXRjaCBjb25zdHJ1Y3RvclxuICAgIGlmIChhcmdzKSBjbWQuYXJndW1lbnRzKGFyZ3MpO1xuICAgIHRoaXMuY29tbWFuZHMucHVzaChjbWQpO1xuICAgIGNtZC5wYXJlbnQgPSB0aGlzO1xuICAgIGNtZC5jb3B5SW5oZXJpdGVkU2V0dGluZ3ModGhpcyk7XG5cbiAgICBpZiAoZGVzYykgcmV0dXJuIHRoaXM7XG4gICAgcmV0dXJuIGNtZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBGYWN0b3J5IHJvdXRpbmUgdG8gY3JlYXRlIGEgbmV3IHVuYXR0YWNoZWQgY29tbWFuZC5cbiAgICpcbiAgICogU2VlIC5jb21tYW5kKCkgZm9yIGNyZWF0aW5nIGFuIGF0dGFjaGVkIHN1YmNvbW1hbmQsIHdoaWNoIHVzZXMgdGhpcyByb3V0aW5lIHRvXG4gICAqIGNyZWF0ZSB0aGUgY29tbWFuZC4gWW91IGNhbiBvdmVycmlkZSBjcmVhdGVDb21tYW5kIHRvIGN1c3RvbWlzZSBzdWJjb21tYW5kcy5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtuYW1lXVxuICAgKiBAcmV0dXJuIHtDb21tYW5kfSBuZXcgY29tbWFuZFxuICAgKi9cblxuICBjcmVhdGVDb21tYW5kKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IENvbW1hbmQobmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogWW91IGNhbiBjdXN0b21pc2UgdGhlIGhlbHAgd2l0aCBhIHN1YmNsYXNzIG9mIEhlbHAgYnkgb3ZlcnJpZGluZyBjcmVhdGVIZWxwLFxuICAgKiBvciBieSBvdmVycmlkaW5nIEhlbHAgcHJvcGVydGllcyB1c2luZyBjb25maWd1cmVIZWxwKCkuXG4gICAqXG4gICAqIEByZXR1cm4ge0hlbHB9XG4gICAqL1xuXG4gIGNyZWF0ZUhlbHAoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24obmV3IEhlbHAoKSwgdGhpcy5jb25maWd1cmVIZWxwKCkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFlvdSBjYW4gY3VzdG9taXNlIHRoZSBoZWxwIGJ5IG92ZXJyaWRpbmcgSGVscCBwcm9wZXJ0aWVzIHVzaW5nIGNvbmZpZ3VyZUhlbHAoKSxcbiAgICogb3Igd2l0aCBhIHN1YmNsYXNzIG9mIEhlbHAgYnkgb3ZlcnJpZGluZyBjcmVhdGVIZWxwKCkuXG4gICAqXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbY29uZmlndXJhdGlvbl0gLSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAgICogQHJldHVybiB7Q29tbWFuZHxPYmplY3R9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZywgb3Igc3RvcmVkIGNvbmZpZ3VyYXRpb25cbiAgICovXG5cbiAgY29uZmlndXJlSGVscChjb25maWd1cmF0aW9uKSB7XG4gICAgaWYgKGNvbmZpZ3VyYXRpb24gPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2hlbHBDb25maWd1cmF0aW9uO1xuXG4gICAgdGhpcy5faGVscENvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBkZWZhdWx0IG91dHB1dCBnb2VzIHRvIHN0ZG91dCBhbmQgc3RkZXJyLiBZb3UgY2FuIGN1c3RvbWlzZSB0aGlzIGZvciBzcGVjaWFsXG4gICAqIGFwcGxpY2F0aW9ucy4gWW91IGNhbiBhbHNvIGN1c3RvbWlzZSB0aGUgZGlzcGxheSBvZiBlcnJvcnMgYnkgb3ZlcnJpZGluZyBvdXRwdXRFcnJvci5cbiAgICpcbiAgICogVGhlIGNvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBhcmUgYWxsIGZ1bmN0aW9uczpcbiAgICpcbiAgICogICAgIC8vIGZ1bmN0aW9ucyB0byBjaGFuZ2Ugd2hlcmUgYmVpbmcgd3JpdHRlbiwgc3Rkb3V0IGFuZCBzdGRlcnJcbiAgICogICAgIHdyaXRlT3V0KHN0cilcbiAgICogICAgIHdyaXRlRXJyKHN0cilcbiAgICogICAgIC8vIG1hdGNoaW5nIGZ1bmN0aW9ucyB0byBzcGVjaWZ5IHdpZHRoIGZvciB3cmFwcGluZyBoZWxwXG4gICAqICAgICBnZXRPdXRIZWxwV2lkdGgoKVxuICAgKiAgICAgZ2V0RXJySGVscFdpZHRoKClcbiAgICogICAgIC8vIGZ1bmN0aW9ucyBiYXNlZCBvbiB3aGF0IGlzIGJlaW5nIHdyaXR0ZW4gb3V0XG4gICAqICAgICBvdXRwdXRFcnJvcihzdHIsIHdyaXRlKSAvLyB1c2VkIGZvciBkaXNwbGF5aW5nIGVycm9ycywgYW5kIG5vdCB1c2VkIGZvciBkaXNwbGF5aW5nIGhlbHBcbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IFtjb25maWd1cmF0aW9uXSAtIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICAgKiBAcmV0dXJuIHtDb21tYW5kfE9iamVjdH0gYHRoaXNgIGNvbW1hbmQgZm9yIGNoYWluaW5nLCBvciBzdG9yZWQgY29uZmlndXJhdGlvblxuICAgKi9cblxuICBjb25maWd1cmVPdXRwdXQoY29uZmlndXJhdGlvbikge1xuICAgIGlmIChjb25maWd1cmF0aW9uID09PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLl9vdXRwdXRDb25maWd1cmF0aW9uO1xuXG4gICAgT2JqZWN0LmFzc2lnbih0aGlzLl9vdXRwdXRDb25maWd1cmF0aW9uLCBjb25maWd1cmF0aW9uKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwbGF5IHRoZSBoZWxwIG9yIGEgY3VzdG9tIG1lc3NhZ2UgYWZ0ZXIgYW4gZXJyb3Igb2NjdXJzLlxuICAgKlxuICAgKiBAcGFyYW0ge2Jvb2xlYW58c3RyaW5nfSBbZGlzcGxheUhlbHBdXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cbiAgc2hvd0hlbHBBZnRlckVycm9yKGRpc3BsYXlIZWxwID0gdHJ1ZSkge1xuICAgIGlmICh0eXBlb2YgZGlzcGxheUhlbHAgIT09ICdzdHJpbmcnKSBkaXNwbGF5SGVscCA9ICEhZGlzcGxheUhlbHA7XG4gICAgdGhpcy5fc2hvd0hlbHBBZnRlckVycm9yID0gZGlzcGxheUhlbHA7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRGlzcGxheSBzdWdnZXN0aW9uIG9mIHNpbWlsYXIgY29tbWFuZHMgZm9yIHVua25vd24gY29tbWFuZHMsIG9yIG9wdGlvbnMgZm9yIHVua25vd24gb3B0aW9ucy5cbiAgICpcbiAgICogQHBhcmFtIHtib29sZWFufSBbZGlzcGxheVN1Z2dlc3Rpb25dXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cbiAgc2hvd1N1Z2dlc3Rpb25BZnRlckVycm9yKGRpc3BsYXlTdWdnZXN0aW9uID0gdHJ1ZSkge1xuICAgIHRoaXMuX3Nob3dTdWdnZXN0aW9uQWZ0ZXJFcnJvciA9ICEhZGlzcGxheVN1Z2dlc3Rpb247XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGEgcHJlcGFyZWQgc3ViY29tbWFuZC5cbiAgICpcbiAgICogU2VlIC5jb21tYW5kKCkgZm9yIGNyZWF0aW5nIGFuIGF0dGFjaGVkIHN1YmNvbW1hbmQgd2hpY2ggaW5oZXJpdHMgc2V0dGluZ3MgZnJvbSBpdHMgcGFyZW50LlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbW1hbmR9IGNtZCAtIG5ldyBzdWJjb21tYW5kXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0c10gLSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAgICogQHJldHVybiB7Q29tbWFuZH0gYHRoaXNgIGNvbW1hbmQgZm9yIGNoYWluaW5nXG4gICAqL1xuXG4gIGFkZENvbW1hbmQoY21kLCBvcHRzKSB7XG4gICAgaWYgKCFjbWQuX25hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29tbWFuZCBwYXNzZWQgdG8gLmFkZENvbW1hbmQoKSBtdXN0IGhhdmUgYSBuYW1lXG4tIHNwZWNpZnkgdGhlIG5hbWUgaW4gQ29tbWFuZCBjb25zdHJ1Y3RvciBvciB1c2luZyAubmFtZSgpYCk7XG4gICAgfVxuXG4gICAgb3B0cyA9IG9wdHMgfHwge307XG4gICAgaWYgKG9wdHMuaXNEZWZhdWx0KSB0aGlzLl9kZWZhdWx0Q29tbWFuZE5hbWUgPSBjbWQuX25hbWU7XG4gICAgaWYgKG9wdHMubm9IZWxwIHx8IG9wdHMuaGlkZGVuKSBjbWQuX2hpZGRlbiA9IHRydWU7IC8vIG1vZGlmeWluZyBwYXNzZWQgY29tbWFuZCBkdWUgdG8gZXhpc3RpbmcgaW1wbGVtZW50YXRpb25cblxuICAgIHRoaXMuY29tbWFuZHMucHVzaChjbWQpO1xuICAgIGNtZC5wYXJlbnQgPSB0aGlzO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEZhY3Rvcnkgcm91dGluZSB0byBjcmVhdGUgYSBuZXcgdW5hdHRhY2hlZCBhcmd1bWVudC5cbiAgICpcbiAgICogU2VlIC5hcmd1bWVudCgpIGZvciBjcmVhdGluZyBhbiBhdHRhY2hlZCBhcmd1bWVudCwgd2hpY2ggdXNlcyB0aGlzIHJvdXRpbmUgdG9cbiAgICogY3JlYXRlIHRoZSBhcmd1bWVudC4gWW91IGNhbiBvdmVycmlkZSBjcmVhdGVBcmd1bWVudCB0byByZXR1cm4gYSBjdXN0b20gYXJndW1lbnQuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dXG4gICAqIEByZXR1cm4ge0FyZ3VtZW50fSBuZXcgYXJndW1lbnRcbiAgICovXG5cbiAgY3JlYXRlQXJndW1lbnQobmFtZSwgZGVzY3JpcHRpb24pIHtcbiAgICByZXR1cm4gbmV3IEFyZ3VtZW50KG5hbWUsIGRlc2NyaXB0aW9uKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWZpbmUgYXJndW1lbnQgc3ludGF4IGZvciBjb21tYW5kLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBpcyB0aGF0IHRoZSBhcmd1bWVudCBpcyByZXF1aXJlZCwgYW5kIHlvdSBjYW4gZXhwbGljaXRseVxuICAgKiBpbmRpY2F0ZSB0aGlzIHdpdGggPD4gYXJvdW5kIHRoZSBuYW1lLiBQdXQgW10gYXJvdW5kIHRoZSBuYW1lIGZvciBhbiBvcHRpb25hbCBhcmd1bWVudC5cbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogcHJvZ3JhbS5hcmd1bWVudCgnPGlucHV0LWZpbGU+Jyk7XG4gICAqIHByb2dyYW0uYXJndW1lbnQoJ1tvdXRwdXQtZmlsZV0nKTtcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkZXNjcmlwdGlvbl1cbiAgICogQHBhcmFtIHtGdW5jdGlvbnwqfSBbZm5dIC0gY3VzdG9tIGFyZ3VtZW50IHByb2Nlc3NpbmcgZnVuY3Rpb25cbiAgICogQHBhcmFtIHsqfSBbZGVmYXVsdFZhbHVlXVxuICAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgICovXG4gIGFyZ3VtZW50KG5hbWUsIGRlc2NyaXB0aW9uLCBmbiwgZGVmYXVsdFZhbHVlKSB7XG4gICAgY29uc3QgYXJndW1lbnQgPSB0aGlzLmNyZWF0ZUFyZ3VtZW50KG5hbWUsIGRlc2NyaXB0aW9uKTtcbiAgICBpZiAodHlwZW9mIGZuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBhcmd1bWVudC5kZWZhdWx0KGRlZmF1bHRWYWx1ZSkuYXJnUGFyc2VyKGZuKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXJndW1lbnQuZGVmYXVsdChmbik7XG4gICAgfVxuICAgIHRoaXMuYWRkQXJndW1lbnQoYXJndW1lbnQpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZSBhcmd1bWVudCBzeW50YXggZm9yIGNvbW1hbmQsIGFkZGluZyBtdWx0aXBsZSBhdCBvbmNlICh3aXRob3V0IGRlc2NyaXB0aW9ucykuXG4gICAqXG4gICAqIFNlZSBhbHNvIC5hcmd1bWVudCgpLlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBwcm9ncmFtLmFyZ3VtZW50cygnPGNtZD4gW2Vudl0nKTtcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVzXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cblxuICBhcmd1bWVudHMobmFtZXMpIHtcbiAgICBuYW1lcy5zcGxpdCgvICsvKS5mb3JFYWNoKChkZXRhaWwpID0+IHtcbiAgICAgIHRoaXMuYXJndW1lbnQoZGV0YWlsKTtcbiAgICB9KTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWZpbmUgYXJndW1lbnQgc3ludGF4IGZvciBjb21tYW5kLCBhZGRpbmcgYSBwcmVwYXJlZCBhcmd1bWVudC5cbiAgICpcbiAgICogQHBhcmFtIHtBcmd1bWVudH0gYXJndW1lbnRcbiAgICogQHJldHVybiB7Q29tbWFuZH0gYHRoaXNgIGNvbW1hbmQgZm9yIGNoYWluaW5nXG4gICAqL1xuICBhZGRBcmd1bWVudChhcmd1bWVudCkge1xuICAgIGNvbnN0IHByZXZpb3VzQXJndW1lbnQgPSB0aGlzLl9hcmdzLnNsaWNlKC0xKVswXTtcbiAgICBpZiAocHJldmlvdXNBcmd1bWVudCAmJiBwcmV2aW91c0FyZ3VtZW50LnZhcmlhZGljKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYG9ubHkgdGhlIGxhc3QgYXJndW1lbnQgY2FuIGJlIHZhcmlhZGljICcke3ByZXZpb3VzQXJndW1lbnQubmFtZSgpfSdgKTtcbiAgICB9XG4gICAgaWYgKGFyZ3VtZW50LnJlcXVpcmVkICYmIGFyZ3VtZW50LmRlZmF1bHRWYWx1ZSAhPT0gdW5kZWZpbmVkICYmIGFyZ3VtZW50LnBhcnNlQXJnID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgYSBkZWZhdWx0IHZhbHVlIGZvciBhIHJlcXVpcmVkIGFyZ3VtZW50IGlzIG5ldmVyIHVzZWQ6ICcke2FyZ3VtZW50Lm5hbWUoKX0nYCk7XG4gICAgfVxuICAgIHRoaXMuX2FyZ3MucHVzaChhcmd1bWVudCk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogT3ZlcnJpZGUgZGVmYXVsdCBkZWNpc2lvbiB3aGV0aGVyIHRvIGFkZCBpbXBsaWNpdCBoZWxwIGNvbW1hbmQuXG4gICAqXG4gICAqICAgIGFkZEhlbHBDb21tYW5kKCkgLy8gZm9yY2Ugb25cbiAgICogICAgYWRkSGVscENvbW1hbmQoZmFsc2UpOyAvLyBmb3JjZSBvZmZcbiAgICogICAgYWRkSGVscENvbW1hbmQoJ2hlbHAgW2NtZF0nLCAnZGlzcGxheSBoZWxwIGZvciBbY21kXScpOyAvLyBmb3JjZSBvbiB3aXRoIGN1c3RvbSBkZXRhaWxzXG4gICAqXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cblxuICBhZGRIZWxwQ29tbWFuZChlbmFibGVPck5hbWVBbmRBcmdzLCBkZXNjcmlwdGlvbikge1xuICAgIGlmIChlbmFibGVPck5hbWVBbmRBcmdzID09PSBmYWxzZSkge1xuICAgICAgdGhpcy5fYWRkSW1wbGljaXRIZWxwQ29tbWFuZCA9IGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9hZGRJbXBsaWNpdEhlbHBDb21tYW5kID0gdHJ1ZTtcbiAgICAgIGlmICh0eXBlb2YgZW5hYmxlT3JOYW1lQW5kQXJncyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy5faGVscENvbW1hbmROYW1lID0gZW5hYmxlT3JOYW1lQW5kQXJncy5zcGxpdCgnICcpWzBdO1xuICAgICAgICB0aGlzLl9oZWxwQ29tbWFuZG5hbWVBbmRBcmdzID0gZW5hYmxlT3JOYW1lQW5kQXJncztcbiAgICAgIH1cbiAgICAgIHRoaXMuX2hlbHBDb21tYW5kRGVzY3JpcHRpb24gPSBkZXNjcmlwdGlvbiB8fCB0aGlzLl9oZWxwQ29tbWFuZERlc2NyaXB0aW9uO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBAcmV0dXJuIHtib29sZWFufVxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgX2hhc0ltcGxpY2l0SGVscENvbW1hbmQoKSB7XG4gICAgaWYgKHRoaXMuX2FkZEltcGxpY2l0SGVscENvbW1hbmQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHRoaXMuY29tbWFuZHMubGVuZ3RoICYmICF0aGlzLl9hY3Rpb25IYW5kbGVyICYmICF0aGlzLl9maW5kQ29tbWFuZCgnaGVscCcpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fYWRkSW1wbGljaXRIZWxwQ29tbWFuZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgaG9vayBmb3IgbGlmZSBjeWNsZSBldmVudC5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50XG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cblxuICBob29rKGV2ZW50LCBsaXN0ZW5lcikge1xuICAgIGNvbnN0IGFsbG93ZWRWYWx1ZXMgPSBbJ3ByZUFjdGlvbicsICdwb3N0QWN0aW9uJ107XG4gICAgaWYgKCFhbGxvd2VkVmFsdWVzLmluY2x1ZGVzKGV2ZW50KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHZhbHVlIGZvciBldmVudCBwYXNzZWQgdG8gaG9vayA6ICcke2V2ZW50fScuXG5FeHBlY3Rpbmcgb25lIG9mICcke2FsbG93ZWRWYWx1ZXMuam9pbihcIicsICdcIil9J2ApO1xuICAgIH1cbiAgICBpZiAodGhpcy5fbGlmZUN5Y2xlSG9va3NbZXZlbnRdKSB7XG4gICAgICB0aGlzLl9saWZlQ3ljbGVIb29rc1tldmVudF0ucHVzaChsaXN0ZW5lcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2xpZmVDeWNsZUhvb2tzW2V2ZW50XSA9IFtsaXN0ZW5lcl07XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGNhbGxiYWNrIHRvIHVzZSBhcyByZXBsYWNlbWVudCBmb3IgY2FsbGluZyBwcm9jZXNzLmV4aXQuXG4gICAqXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IFtmbl0gb3B0aW9uYWwgY2FsbGJhY2sgd2hpY2ggd2lsbCBiZSBwYXNzZWQgYSBDb21tYW5kZXJFcnJvciwgZGVmYXVsdHMgdG8gdGhyb3dpbmdcbiAgICogQHJldHVybiB7Q29tbWFuZH0gYHRoaXNgIGNvbW1hbmQgZm9yIGNoYWluaW5nXG4gICAqL1xuXG4gIGV4aXRPdmVycmlkZShmbikge1xuICAgIGlmIChmbikge1xuICAgICAgdGhpcy5fZXhpdENhbGxiYWNrID0gZm47XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2V4aXRDYWxsYmFjayA9IChlcnIpID0+IHtcbiAgICAgICAgaWYgKGVyci5jb2RlICE9PSAnY29tbWFuZGVyLmV4ZWN1dGVTdWJDb21tYW5kQXN5bmMnKSB7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIEFzeW5jIGNhbGxiYWNrIGZyb20gc3Bhd24gZXZlbnRzLCBub3QgdXNlZnVsIHRvIHRocm93LlxuICAgICAgICB9XG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsIHByb2Nlc3MuZXhpdCwgYW5kIF9leGl0Q2FsbGJhY2sgaWYgZGVmaW5lZC5cbiAgICpcbiAgICogQHBhcmFtIHtudW1iZXJ9IGV4aXRDb2RlIGV4aXQgY29kZSBmb3IgdXNpbmcgd2l0aCBwcm9jZXNzLmV4aXRcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvZGUgYW4gaWQgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgZXJyb3JcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgaHVtYW4tcmVhZGFibGUgZGVzY3JpcHRpb24gb2YgdGhlIGVycm9yXG4gICAqIEByZXR1cm4gbmV2ZXJcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIF9leGl0KGV4aXRDb2RlLCBjb2RlLCBtZXNzYWdlKSB7XG4gICAgaWYgKHRoaXMuX2V4aXRDYWxsYmFjaykge1xuICAgICAgdGhpcy5fZXhpdENhbGxiYWNrKG5ldyBDb21tYW5kZXJFcnJvcihleGl0Q29kZSwgY29kZSwgbWVzc2FnZSkpO1xuICAgICAgLy8gRXhwZWN0aW5nIHRoaXMgbGluZSBpcyBub3QgcmVhY2hlZC5cbiAgICB9XG4gICAgcHJvY2Vzcy5leGl0KGV4aXRDb2RlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBjYWxsYmFjayBgZm5gIGZvciB0aGUgY29tbWFuZC5cbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogcHJvZ3JhbVxuICAgKiAgIC5jb21tYW5kKCdzZXJ2ZScpXG4gICAqICAgLmRlc2NyaXB0aW9uKCdzdGFydCBzZXJ2aWNlJylcbiAgICogICAuYWN0aW9uKGZ1bmN0aW9uKCkge1xuICAgKiAgICAgIC8vIGRvIHdvcmsgaGVyZVxuICAgKiAgIH0pO1xuICAgKlxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgICovXG5cbiAgYWN0aW9uKGZuKSB7XG4gICAgY29uc3QgbGlzdGVuZXIgPSAoYXJncykgPT4ge1xuICAgICAgLy8gVGhlIC5hY3Rpb24gY2FsbGJhY2sgdGFrZXMgYW4gZXh0cmEgcGFyYW1ldGVyIHdoaWNoIGlzIHRoZSBjb21tYW5kIG9yIG9wdGlvbnMuXG4gICAgICBjb25zdCBleHBlY3RlZEFyZ3NDb3VudCA9IHRoaXMuX2FyZ3MubGVuZ3RoO1xuICAgICAgY29uc3QgYWN0aW9uQXJncyA9IGFyZ3Muc2xpY2UoMCwgZXhwZWN0ZWRBcmdzQ291bnQpO1xuICAgICAgaWYgKHRoaXMuX3N0b3JlT3B0aW9uc0FzUHJvcGVydGllcykge1xuICAgICAgICBhY3Rpb25BcmdzW2V4cGVjdGVkQXJnc0NvdW50XSA9IHRoaXM7IC8vIGJhY2t3YXJkcyBjb21wYXRpYmxlIFwib3B0aW9uc1wiXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhY3Rpb25BcmdzW2V4cGVjdGVkQXJnc0NvdW50XSA9IHRoaXMub3B0cygpO1xuICAgICAgfVxuICAgICAgYWN0aW9uQXJncy5wdXNoKHRoaXMpO1xuXG4gICAgICByZXR1cm4gZm4uYXBwbHkodGhpcywgYWN0aW9uQXJncyk7XG4gICAgfTtcbiAgICB0aGlzLl9hY3Rpb25IYW5kbGVyID0gbGlzdGVuZXI7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRmFjdG9yeSByb3V0aW5lIHRvIGNyZWF0ZSBhIG5ldyB1bmF0dGFjaGVkIG9wdGlvbi5cbiAgICpcbiAgICogU2VlIC5vcHRpb24oKSBmb3IgY3JlYXRpbmcgYW4gYXR0YWNoZWQgb3B0aW9uLCB3aGljaCB1c2VzIHRoaXMgcm91dGluZSB0b1xuICAgKiBjcmVhdGUgdGhlIG9wdGlvbi4gWW91IGNhbiBvdmVycmlkZSBjcmVhdGVPcHRpb24gdG8gcmV0dXJuIGEgY3VzdG9tIG9wdGlvbi5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZsYWdzXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dXG4gICAqIEByZXR1cm4ge09wdGlvbn0gbmV3IG9wdGlvblxuICAgKi9cblxuICBjcmVhdGVPcHRpb24oZmxhZ3MsIGRlc2NyaXB0aW9uKSB7XG4gICAgcmV0dXJuIG5ldyBPcHRpb24oZmxhZ3MsIGRlc2NyaXB0aW9uKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYW4gb3B0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0ge09wdGlvbn0gb3B0aW9uXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cbiAgYWRkT3B0aW9uKG9wdGlvbikge1xuICAgIGNvbnN0IG9uYW1lID0gb3B0aW9uLm5hbWUoKTtcbiAgICBjb25zdCBuYW1lID0gb3B0aW9uLmF0dHJpYnV0ZU5hbWUoKTtcblxuICAgIC8vIHN0b3JlIGRlZmF1bHQgdmFsdWVcbiAgICBpZiAob3B0aW9uLm5lZ2F0ZSkge1xuICAgICAgLy8gLS1uby1mb28gaXMgc3BlY2lhbCBhbmQgZGVmYXVsdHMgZm9vIHRvIHRydWUsIHVubGVzcyBhIC0tZm9vIG9wdGlvbiBpcyBhbHJlYWR5IGRlZmluZWRcbiAgICAgIGNvbnN0IHBvc2l0aXZlTG9uZ0ZsYWcgPSBvcHRpb24ubG9uZy5yZXBsYWNlKC9eLS1uby0vLCAnLS0nKTtcbiAgICAgIGlmICghdGhpcy5fZmluZE9wdGlvbihwb3NpdGl2ZUxvbmdGbGFnKSkge1xuICAgICAgICB0aGlzLnNldE9wdGlvblZhbHVlV2l0aFNvdXJjZShuYW1lLCBvcHRpb24uZGVmYXVsdFZhbHVlID09PSB1bmRlZmluZWQgPyB0cnVlIDogb3B0aW9uLmRlZmF1bHRWYWx1ZSwgJ2RlZmF1bHQnKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKG9wdGlvbi5kZWZhdWx0VmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5zZXRPcHRpb25WYWx1ZVdpdGhTb3VyY2UobmFtZSwgb3B0aW9uLmRlZmF1bHRWYWx1ZSwgJ2RlZmF1bHQnKTtcbiAgICB9XG5cbiAgICAvLyByZWdpc3RlciB0aGUgb3B0aW9uXG4gICAgdGhpcy5vcHRpb25zLnB1c2gob3B0aW9uKTtcblxuICAgIC8vIGhhbmRsZXIgZm9yIGNsaSBhbmQgZW52IHN1cHBsaWVkIHZhbHVlc1xuICAgIGNvbnN0IGhhbmRsZU9wdGlvblZhbHVlID0gKHZhbCwgaW52YWxpZFZhbHVlTWVzc2FnZSwgdmFsdWVTb3VyY2UpID0+IHtcbiAgICAgIC8vIHZhbCBpcyBudWxsIGZvciBvcHRpb25hbCBvcHRpb24gdXNlZCB3aXRob3V0IGFuIG9wdGlvbmFsLWFyZ3VtZW50LlxuICAgICAgLy8gdmFsIGlzIHVuZGVmaW5lZCBmb3IgYm9vbGVhbiBhbmQgbmVnYXRlZCBvcHRpb24uXG4gICAgICBpZiAodmFsID09IG51bGwgJiYgb3B0aW9uLnByZXNldEFyZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHZhbCA9IG9wdGlvbi5wcmVzZXRBcmc7XG4gICAgICB9XG5cbiAgICAgIC8vIGN1c3RvbSBwcm9jZXNzaW5nXG4gICAgICBjb25zdCBvbGRWYWx1ZSA9IHRoaXMuZ2V0T3B0aW9uVmFsdWUobmFtZSk7XG4gICAgICBpZiAodmFsICE9PSBudWxsICYmIG9wdGlvbi5wYXJzZUFyZykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHZhbCA9IG9wdGlvbi5wYXJzZUFyZyh2YWwsIG9sZFZhbHVlKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgaWYgKGVyci5jb2RlID09PSAnY29tbWFuZGVyLmludmFsaWRBcmd1bWVudCcpIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgJHtpbnZhbGlkVmFsdWVNZXNzYWdlfSAke2Vyci5tZXNzYWdlfWA7XG4gICAgICAgICAgICB0aGlzLmVycm9yKG1lc3NhZ2UsIHsgZXhpdENvZGU6IGVyci5leGl0Q29kZSwgY29kZTogZXJyLmNvZGUgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh2YWwgIT09IG51bGwgJiYgb3B0aW9uLnZhcmlhZGljKSB7XG4gICAgICAgIHZhbCA9IG9wdGlvbi5fY29uY2F0VmFsdWUodmFsLCBvbGRWYWx1ZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEZpbGwtaW4gYXBwcm9wcmlhdGUgbWlzc2luZyB2YWx1ZXMuIExvbmcgd2luZGVkIGJ1dCBlYXN5IHRvIGZvbGxvdy5cbiAgICAgIGlmICh2YWwgPT0gbnVsbCkge1xuICAgICAgICBpZiAob3B0aW9uLm5lZ2F0ZSkge1xuICAgICAgICAgIHZhbCA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKG9wdGlvbi5pc0Jvb2xlYW4oKSB8fCBvcHRpb24ub3B0aW9uYWwpIHtcbiAgICAgICAgICB2YWwgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhbCA9ICcnOyAvLyBub3Qgbm9ybWFsLCBwYXJzZUFyZyBtaWdodCBoYXZlIGZhaWxlZCBvciBiZSBhIG1vY2sgZnVuY3Rpb24gZm9yIHRlc3RpbmdcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5zZXRPcHRpb25WYWx1ZVdpdGhTb3VyY2UobmFtZSwgdmFsLCB2YWx1ZVNvdXJjZSk7XG4gICAgfTtcblxuICAgIHRoaXMub24oJ29wdGlvbjonICsgb25hbWUsICh2YWwpID0+IHtcbiAgICAgIGNvbnN0IGludmFsaWRWYWx1ZU1lc3NhZ2UgPSBgZXJyb3I6IG9wdGlvbiAnJHtvcHRpb24uZmxhZ3N9JyBhcmd1bWVudCAnJHt2YWx9JyBpcyBpbnZhbGlkLmA7XG4gICAgICBoYW5kbGVPcHRpb25WYWx1ZSh2YWwsIGludmFsaWRWYWx1ZU1lc3NhZ2UsICdjbGknKTtcbiAgICB9KTtcblxuICAgIGlmIChvcHRpb24uZW52VmFyKSB7XG4gICAgICB0aGlzLm9uKCdvcHRpb25FbnY6JyArIG9uYW1lLCAodmFsKSA9PiB7XG4gICAgICAgIGNvbnN0IGludmFsaWRWYWx1ZU1lc3NhZ2UgPSBgZXJyb3I6IG9wdGlvbiAnJHtvcHRpb24uZmxhZ3N9JyB2YWx1ZSAnJHt2YWx9JyBmcm9tIGVudiAnJHtvcHRpb24uZW52VmFyfScgaXMgaW52YWxpZC5gO1xuICAgICAgICBoYW5kbGVPcHRpb25WYWx1ZSh2YWwsIGludmFsaWRWYWx1ZU1lc3NhZ2UsICdlbnYnKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIGltcGxlbWVudGF0aW9uIHNoYXJlZCBieSAub3B0aW9uKCkgYW5kIC5yZXF1aXJlZE9wdGlvbigpXG4gICAqXG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cbiAgX29wdGlvbkV4KGNvbmZpZywgZmxhZ3MsIGRlc2NyaXB0aW9uLCBmbiwgZGVmYXVsdFZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiBmbGFncyA9PT0gJ29iamVjdCcgJiYgZmxhZ3MgaW5zdGFuY2VvZiBPcHRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVG8gYWRkIGFuIE9wdGlvbiBvYmplY3QgdXNlIGFkZE9wdGlvbigpIGluc3RlYWQgb2Ygb3B0aW9uKCkgb3IgcmVxdWlyZWRPcHRpb24oKScpO1xuICAgIH1cbiAgICBjb25zdCBvcHRpb24gPSB0aGlzLmNyZWF0ZU9wdGlvbihmbGFncywgZGVzY3JpcHRpb24pO1xuICAgIG9wdGlvbi5tYWtlT3B0aW9uTWFuZGF0b3J5KCEhY29uZmlnLm1hbmRhdG9yeSk7XG4gICAgaWYgKHR5cGVvZiBmbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgb3B0aW9uLmRlZmF1bHQoZGVmYXVsdFZhbHVlKS5hcmdQYXJzZXIoZm4pO1xuICAgIH0gZWxzZSBpZiAoZm4gaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIC8vIGRlcHJlY2F0ZWRcbiAgICAgIGNvbnN0IHJlZ2V4ID0gZm47XG4gICAgICBmbiA9ICh2YWwsIGRlZikgPT4ge1xuICAgICAgICBjb25zdCBtID0gcmVnZXguZXhlYyh2YWwpO1xuICAgICAgICByZXR1cm4gbSA/IG1bMF0gOiBkZWY7XG4gICAgICB9O1xuICAgICAgb3B0aW9uLmRlZmF1bHQoZGVmYXVsdFZhbHVlKS5hcmdQYXJzZXIoZm4pO1xuICAgIH0gZWxzZSB7XG4gICAgICBvcHRpb24uZGVmYXVsdChmbik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYWRkT3B0aW9uKG9wdGlvbik7XG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lIG9wdGlvbiB3aXRoIGBmbGFnc2AsIGBkZXNjcmlwdGlvbmAgYW5kIG9wdGlvbmFsXG4gICAqIGNvZXJjaW9uIGBmbmAuXG4gICAqXG4gICAqIFRoZSBgZmxhZ3NgIHN0cmluZyBjb250YWlucyB0aGUgc2hvcnQgYW5kL29yIGxvbmcgZmxhZ3MsXG4gICAqIHNlcGFyYXRlZCBieSBjb21tYSwgYSBwaXBlIG9yIHNwYWNlLiBUaGUgZm9sbG93aW5nIGFyZSBhbGwgdmFsaWRcbiAgICogYWxsIHdpbGwgb3V0cHV0IHRoaXMgd2F5IHdoZW4gYC0taGVscGAgaXMgdXNlZC5cbiAgICpcbiAgICogICAgIFwiLXAsIC0tcGVwcGVyXCJcbiAgICogICAgIFwiLXB8LS1wZXBwZXJcIlxuICAgKiAgICAgXCItcCAtLXBlcHBlclwiXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIC8vIHNpbXBsZSBib29sZWFuIGRlZmF1bHRpbmcgdG8gdW5kZWZpbmVkXG4gICAqIHByb2dyYW0ub3B0aW9uKCctcCwgLS1wZXBwZXInLCAnYWRkIHBlcHBlcicpO1xuICAgKlxuICAgKiBwcm9ncmFtLnBlcHBlclxuICAgKiAvLyA9PiB1bmRlZmluZWRcbiAgICpcbiAgICogLS1wZXBwZXJcbiAgICogcHJvZ3JhbS5wZXBwZXJcbiAgICogLy8gPT4gdHJ1ZVxuICAgKlxuICAgKiAvLyBzaW1wbGUgYm9vbGVhbiBkZWZhdWx0aW5nIHRvIHRydWUgKHVubGVzcyBub24tbmVnYXRlZCBvcHRpb24gaXMgYWxzbyBkZWZpbmVkKVxuICAgKiBwcm9ncmFtLm9wdGlvbignLUMsIC0tbm8tY2hlZXNlJywgJ3JlbW92ZSBjaGVlc2UnKTtcbiAgICpcbiAgICogcHJvZ3JhbS5jaGVlc2VcbiAgICogLy8gPT4gdHJ1ZVxuICAgKlxuICAgKiAtLW5vLWNoZWVzZVxuICAgKiBwcm9ncmFtLmNoZWVzZVxuICAgKiAvLyA9PiBmYWxzZVxuICAgKlxuICAgKiAvLyByZXF1aXJlZCBhcmd1bWVudFxuICAgKiBwcm9ncmFtLm9wdGlvbignLUMsIC0tY2hkaXIgPHBhdGg+JywgJ2NoYW5nZSB0aGUgd29ya2luZyBkaXJlY3RvcnknKTtcbiAgICpcbiAgICogLS1jaGRpciAvdG1wXG4gICAqIHByb2dyYW0uY2hkaXJcbiAgICogLy8gPT4gXCIvdG1wXCJcbiAgICpcbiAgICogLy8gb3B0aW9uYWwgYXJndW1lbnRcbiAgICogcHJvZ3JhbS5vcHRpb24oJy1jLCAtLWNoZWVzZSBbdHlwZV0nLCAnYWRkIGNoZWVzZSBbbWFyYmxlXScpO1xuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmxhZ3NcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkZXNjcmlwdGlvbl1cbiAgICogQHBhcmFtIHtGdW5jdGlvbnwqfSBbZm5dIC0gY3VzdG9tIG9wdGlvbiBwcm9jZXNzaW5nIGZ1bmN0aW9uIG9yIGRlZmF1bHQgdmFsdWVcbiAgICogQHBhcmFtIHsqfSBbZGVmYXVsdFZhbHVlXVxuICAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgICovXG5cbiAgb3B0aW9uKGZsYWdzLCBkZXNjcmlwdGlvbiwgZm4sIGRlZmF1bHRWYWx1ZSkge1xuICAgIHJldHVybiB0aGlzLl9vcHRpb25FeCh7fSwgZmxhZ3MsIGRlc2NyaXB0aW9uLCBmbiwgZGVmYXVsdFZhbHVlKTtcbiAgfVxuXG4gIC8qKlxuICAqIEFkZCBhIHJlcXVpcmVkIG9wdGlvbiB3aGljaCBtdXN0IGhhdmUgYSB2YWx1ZSBhZnRlciBwYXJzaW5nLiBUaGlzIHVzdWFsbHkgbWVhbnNcbiAgKiB0aGUgb3B0aW9uIG11c3QgYmUgc3BlY2lmaWVkIG9uIHRoZSBjb21tYW5kIGxpbmUuIChPdGhlcndpc2UgdGhlIHNhbWUgYXMgLm9wdGlvbigpLilcbiAgKlxuICAqIFRoZSBgZmxhZ3NgIHN0cmluZyBjb250YWlucyB0aGUgc2hvcnQgYW5kL29yIGxvbmcgZmxhZ3MsIHNlcGFyYXRlZCBieSBjb21tYSwgYSBwaXBlIG9yIHNwYWNlLlxuICAqXG4gICogQHBhcmFtIHtzdHJpbmd9IGZsYWdzXG4gICogQHBhcmFtIHtzdHJpbmd9IFtkZXNjcmlwdGlvbl1cbiAgKiBAcGFyYW0ge0Z1bmN0aW9ufCp9IFtmbl0gLSBjdXN0b20gb3B0aW9uIHByb2Nlc3NpbmcgZnVuY3Rpb24gb3IgZGVmYXVsdCB2YWx1ZVxuICAqIEBwYXJhbSB7Kn0gW2RlZmF1bHRWYWx1ZV1cbiAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgKi9cblxuICByZXF1aXJlZE9wdGlvbihmbGFncywgZGVzY3JpcHRpb24sIGZuLCBkZWZhdWx0VmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uRXgoeyBtYW5kYXRvcnk6IHRydWUgfSwgZmxhZ3MsIGRlc2NyaXB0aW9uLCBmbiwgZGVmYXVsdFZhbHVlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBbHRlciBwYXJzaW5nIG9mIHNob3J0IGZsYWdzIHdpdGggb3B0aW9uYWwgdmFsdWVzLlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiAvLyBmb3IgYC5vcHRpb24oJy1mLC0tZmxhZyBbdmFsdWVdJyk6XG4gICAqIHByb2dyYW0uY29tYmluZUZsYWdBbmRPcHRpb25hbFZhbHVlKHRydWUpOyAgLy8gYC1mODBgIGlzIHRyZWF0ZWQgbGlrZSBgLS1mbGFnPTgwYCwgdGhpcyBpcyB0aGUgZGVmYXVsdCBiZWhhdmlvdXJcbiAgICogcHJvZ3JhbS5jb21iaW5lRmxhZ0FuZE9wdGlvbmFsVmFsdWUoZmFsc2UpIC8vIGAtZmJgIGlzIHRyZWF0ZWQgbGlrZSBgLWYgLWJgXG4gICAqXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gW2NvbWJpbmU9dHJ1ZV0gLSBpZiBgdHJ1ZWAgb3Igb21pdHRlZCwgYW4gb3B0aW9uYWwgdmFsdWUgY2FuIGJlIHNwZWNpZmllZCBkaXJlY3RseSBhZnRlciB0aGUgZmxhZy5cbiAgICovXG4gIGNvbWJpbmVGbGFnQW5kT3B0aW9uYWxWYWx1ZShjb21iaW5lID0gdHJ1ZSkge1xuICAgIHRoaXMuX2NvbWJpbmVGbGFnQW5kT3B0aW9uYWxWYWx1ZSA9ICEhY29tYmluZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGxvdyB1bmtub3duIG9wdGlvbnMgb24gdGhlIGNvbW1hbmQgbGluZS5cbiAgICpcbiAgICogQHBhcmFtIHtCb29sZWFufSBbYWxsb3dVbmtub3duPXRydWVdIC0gaWYgYHRydWVgIG9yIG9taXR0ZWQsIG5vIGVycm9yIHdpbGwgYmUgdGhyb3duXG4gICAqIGZvciB1bmtub3duIG9wdGlvbnMuXG4gICAqL1xuICBhbGxvd1Vua25vd25PcHRpb24oYWxsb3dVbmtub3duID0gdHJ1ZSkge1xuICAgIHRoaXMuX2FsbG93VW5rbm93bk9wdGlvbiA9ICEhYWxsb3dVbmtub3duO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEFsbG93IGV4Y2VzcyBjb21tYW5kLWFyZ3VtZW50cyBvbiB0aGUgY29tbWFuZCBsaW5lLiBQYXNzIGZhbHNlIHRvIG1ha2UgZXhjZXNzIGFyZ3VtZW50cyBhbiBlcnJvci5cbiAgICpcbiAgICogQHBhcmFtIHtCb29sZWFufSBbYWxsb3dFeGNlc3M9dHJ1ZV0gLSBpZiBgdHJ1ZWAgb3Igb21pdHRlZCwgbm8gZXJyb3Igd2lsbCBiZSB0aHJvd25cbiAgICogZm9yIGV4Y2VzcyBhcmd1bWVudHMuXG4gICAqL1xuICBhbGxvd0V4Y2Vzc0FyZ3VtZW50cyhhbGxvd0V4Y2VzcyA9IHRydWUpIHtcbiAgICB0aGlzLl9hbGxvd0V4Y2Vzc0FyZ3VtZW50cyA9ICEhYWxsb3dFeGNlc3M7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogRW5hYmxlIHBvc2l0aW9uYWwgb3B0aW9ucy4gUG9zaXRpb25hbCBtZWFucyBnbG9iYWwgb3B0aW9ucyBhcmUgc3BlY2lmaWVkIGJlZm9yZSBzdWJjb21tYW5kcyB3aGljaCBsZXRzXG4gICAqIHN1YmNvbW1hbmRzIHJldXNlIHRoZSBzYW1lIG9wdGlvbiBuYW1lcywgYW5kIGFsc28gZW5hYmxlcyBzdWJjb21tYW5kcyB0byB0dXJuIG9uIHBhc3NUaHJvdWdoT3B0aW9ucy5cbiAgICogVGhlIGRlZmF1bHQgYmVoYXZpb3VyIGlzIG5vbi1wb3NpdGlvbmFsIGFuZCBnbG9iYWwgb3B0aW9ucyBtYXkgYXBwZWFyIGFueXdoZXJlIG9uIHRoZSBjb21tYW5kIGxpbmUuXG4gICAqXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gW3Bvc2l0aW9uYWw9dHJ1ZV1cbiAgICovXG4gIGVuYWJsZVBvc2l0aW9uYWxPcHRpb25zKHBvc2l0aW9uYWwgPSB0cnVlKSB7XG4gICAgdGhpcy5fZW5hYmxlUG9zaXRpb25hbE9wdGlvbnMgPSAhIXBvc2l0aW9uYWw7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogUGFzcyB0aHJvdWdoIG9wdGlvbnMgdGhhdCBjb21lIGFmdGVyIGNvbW1hbmQtYXJndW1lbnRzIHJhdGhlciB0aGFuIHRyZWF0IHRoZW0gYXMgY29tbWFuZC1vcHRpb25zLFxuICAgKiBzbyBhY3R1YWwgY29tbWFuZC1vcHRpb25zIGNvbWUgYmVmb3JlIGNvbW1hbmQtYXJndW1lbnRzLiBUdXJuaW5nIHRoaXMgb24gZm9yIGEgc3ViY29tbWFuZCByZXF1aXJlc1xuICAgKiBwb3NpdGlvbmFsIG9wdGlvbnMgdG8gaGF2ZSBiZWVuIGVuYWJsZWQgb24gdGhlIHByb2dyYW0gKHBhcmVudCBjb21tYW5kcykuXG4gICAqIFRoZSBkZWZhdWx0IGJlaGF2aW91ciBpcyBub24tcG9zaXRpb25hbCBhbmQgb3B0aW9ucyBtYXkgYXBwZWFyIGJlZm9yZSBvciBhZnRlciBjb21tYW5kLWFyZ3VtZW50cy5cbiAgICpcbiAgICogQHBhcmFtIHtCb29sZWFufSBbcGFzc1Rocm91Z2g9dHJ1ZV1cbiAgICogZm9yIHVua25vd24gb3B0aW9ucy5cbiAgICovXG4gIHBhc3NUaHJvdWdoT3B0aW9ucyhwYXNzVGhyb3VnaCA9IHRydWUpIHtcbiAgICB0aGlzLl9wYXNzVGhyb3VnaE9wdGlvbnMgPSAhIXBhc3NUaHJvdWdoO1xuICAgIGlmICghIXRoaXMucGFyZW50ICYmIHBhc3NUaHJvdWdoICYmICF0aGlzLnBhcmVudC5fZW5hYmxlUG9zaXRpb25hbE9wdGlvbnMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigncGFzc1Rocm91Z2hPcHRpb25zIGNhbiBub3QgYmUgdXNlZCB3aXRob3V0IHR1cm5pbmcgb24gZW5hYmxlUG9zaXRpb25hbE9wdGlvbnMgZm9yIHBhcmVudCBjb21tYW5kKHMpJyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAgKiBXaGV0aGVyIHRvIHN0b3JlIG9wdGlvbiB2YWx1ZXMgYXMgcHJvcGVydGllcyBvbiBjb21tYW5kIG9iamVjdCxcbiAgICAqIG9yIHN0b3JlIHNlcGFyYXRlbHkgKHNwZWNpZnkgZmFsc2UpLiBJbiBib3RoIGNhc2VzIHRoZSBvcHRpb24gdmFsdWVzIGNhbiBiZSBhY2Nlc3NlZCB1c2luZyAub3B0cygpLlxuICAgICpcbiAgICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3N0b3JlQXNQcm9wZXJ0aWVzPXRydWVdXG4gICAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgICAqL1xuXG4gIHN0b3JlT3B0aW9uc0FzUHJvcGVydGllcyhzdG9yZUFzUHJvcGVydGllcyA9IHRydWUpIHtcbiAgICB0aGlzLl9zdG9yZU9wdGlvbnNBc1Byb3BlcnRpZXMgPSAhIXN0b3JlQXNQcm9wZXJ0aWVzO1xuICAgIGlmICh0aGlzLm9wdGlvbnMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhbGwgLnN0b3JlT3B0aW9uc0FzUHJvcGVydGllcygpIGJlZm9yZSBhZGRpbmcgb3B0aW9ucycpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZSBvcHRpb24gdmFsdWUuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXlcbiAgICogQHJldHVybiB7T2JqZWN0fSB2YWx1ZVxuICAgKi9cblxuICBnZXRPcHRpb25WYWx1ZShrZXkpIHtcbiAgICBpZiAodGhpcy5fc3RvcmVPcHRpb25zQXNQcm9wZXJ0aWVzKSB7XG4gICAgICByZXR1cm4gdGhpc1trZXldO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fb3B0aW9uVmFsdWVzW2tleV07XG4gIH1cblxuICAvKipcbiAgICogU3RvcmUgb3B0aW9uIHZhbHVlLlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5XG4gICAqIEBwYXJhbSB7T2JqZWN0fSB2YWx1ZVxuICAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgICovXG5cbiAgc2V0T3B0aW9uVmFsdWUoa2V5LCB2YWx1ZSkge1xuICAgIGlmICh0aGlzLl9zdG9yZU9wdGlvbnNBc1Byb3BlcnRpZXMpIHtcbiAgICAgIHRoaXNba2V5XSA9IHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9vcHRpb25WYWx1ZXNba2V5XSA9IHZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9yZSBvcHRpb24gdmFsdWUgYW5kIHdoZXJlIHRoZSB2YWx1ZSBjYW1lIGZyb20uXG4gICAgKlxuICAgICogQHBhcmFtIHtzdHJpbmd9IGtleVxuICAgICogQHBhcmFtIHtPYmplY3R9IHZhbHVlXG4gICAgKiBAcGFyYW0ge3N0cmluZ30gc291cmNlIC0gZXhwZWN0ZWQgdmFsdWVzIGFyZSBkZWZhdWx0L2NvbmZpZy9lbnYvY2xpXG4gICAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgICAqL1xuXG4gIHNldE9wdGlvblZhbHVlV2l0aFNvdXJjZShrZXksIHZhbHVlLCBzb3VyY2UpIHtcbiAgICB0aGlzLnNldE9wdGlvblZhbHVlKGtleSwgdmFsdWUpO1xuICAgIHRoaXMuX29wdGlvblZhbHVlU291cmNlc1trZXldID0gc291cmNlO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAgKiBHZXQgc291cmNlIG9mIG9wdGlvbiB2YWx1ZS5cbiAgICAqIEV4cGVjdGVkIHZhbHVlcyBhcmUgZGVmYXVsdCB8IGNvbmZpZyB8IGVudiB8IGNsaVxuICAgICpcbiAgICAqIEBwYXJhbSB7c3RyaW5nfSBrZXlcbiAgICAqIEByZXR1cm4ge3N0cmluZ31cbiAgICAqL1xuXG4gIGdldE9wdGlvblZhbHVlU291cmNlKGtleSkge1xuICAgIHJldHVybiB0aGlzLl9vcHRpb25WYWx1ZVNvdXJjZXNba2V5XTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdXNlciBhcmd1bWVudHMgZnJvbSBpbXBsaWVkIG9yIGV4cGxpY2l0IGFyZ3VtZW50cy5cbiAgICogU2lkZS1lZmZlY3RzOiBzZXQgX3NjcmlwdFBhdGggaWYgYXJncyBpbmNsdWRlZCBzY3JpcHQuIFVzZWQgZm9yIGRlZmF1bHQgcHJvZ3JhbSBuYW1lLCBhbmQgc3ViY29tbWFuZCBzZWFyY2hlcy5cbiAgICpcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIF9wcmVwYXJlVXNlckFyZ3MoYXJndiwgcGFyc2VPcHRpb25zKSB7XG4gICAgaWYgKGFyZ3YgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShhcmd2KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdmaXJzdCBwYXJhbWV0ZXIgdG8gcGFyc2UgbXVzdCBiZSBhcnJheSBvciB1bmRlZmluZWQnKTtcbiAgICB9XG4gICAgcGFyc2VPcHRpb25zID0gcGFyc2VPcHRpb25zIHx8IHt9O1xuXG4gICAgLy8gRGVmYXVsdCB0byB1c2luZyBwcm9jZXNzLmFyZ3ZcbiAgICBpZiAoYXJndiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBhcmd2ID0gcHJvY2Vzcy5hcmd2O1xuICAgICAgLy8gQHRzLWlnbm9yZTogdW5rbm93biBwcm9wZXJ0eVxuICAgICAgaWYgKHByb2Nlc3MudmVyc2lvbnMgJiYgcHJvY2Vzcy52ZXJzaW9ucy5lbGVjdHJvbikge1xuICAgICAgICBwYXJzZU9wdGlvbnMuZnJvbSA9ICdlbGVjdHJvbic7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMucmF3QXJncyA9IGFyZ3Yuc2xpY2UoKTtcblxuICAgIC8vIG1ha2UgaXQgYSBsaXR0bGUgZWFzaWVyIGZvciBjYWxsZXJzIGJ5IHN1cHBvcnRpbmcgdmFyaW91cyBhcmd2IGNvbnZlbnRpb25zXG4gICAgbGV0IHVzZXJBcmdzO1xuICAgIHN3aXRjaCAocGFyc2VPcHRpb25zLmZyb20pIHtcbiAgICAgIGNhc2UgdW5kZWZpbmVkOlxuICAgICAgY2FzZSAnbm9kZSc6XG4gICAgICAgIHRoaXMuX3NjcmlwdFBhdGggPSBhcmd2WzFdO1xuICAgICAgICB1c2VyQXJncyA9IGFyZ3Yuc2xpY2UoMik7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZWxlY3Ryb24nOlxuICAgICAgICAvLyBAdHMtaWdub3JlOiB1bmtub3duIHByb3BlcnR5XG4gICAgICAgIGlmIChwcm9jZXNzLmRlZmF1bHRBcHApIHtcbiAgICAgICAgICB0aGlzLl9zY3JpcHRQYXRoID0gYXJndlsxXTtcbiAgICAgICAgICB1c2VyQXJncyA9IGFyZ3Yuc2xpY2UoMik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdXNlckFyZ3MgPSBhcmd2LnNsaWNlKDEpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndXNlcic6XG4gICAgICAgIHVzZXJBcmdzID0gYXJndi5zbGljZSgwKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHVuZXhwZWN0ZWQgcGFyc2Ugb3B0aW9uIHsgZnJvbTogJyR7cGFyc2VPcHRpb25zLmZyb219JyB9YCk7XG4gICAgfVxuXG4gICAgLy8gRmluZCBkZWZhdWx0IG5hbWUgZm9yIHByb2dyYW0gZnJvbSBhcmd1bWVudHMuXG4gICAgaWYgKCF0aGlzLl9uYW1lICYmIHRoaXMuX3NjcmlwdFBhdGgpIHRoaXMubmFtZUZyb21GaWxlbmFtZSh0aGlzLl9zY3JpcHRQYXRoKTtcbiAgICB0aGlzLl9uYW1lID0gdGhpcy5fbmFtZSB8fCAncHJvZ3JhbSc7XG5cbiAgICByZXR1cm4gdXNlckFyZ3M7XG4gIH1cblxuICAvKipcbiAgICogUGFyc2UgYGFyZ3ZgLCBzZXR0aW5nIG9wdGlvbnMgYW5kIGludm9raW5nIGNvbW1hbmRzIHdoZW4gZGVmaW5lZC5cbiAgICpcbiAgICogVGhlIGRlZmF1bHQgZXhwZWN0YXRpb24gaXMgdGhhdCB0aGUgYXJndW1lbnRzIGFyZSBmcm9tIG5vZGUgYW5kIGhhdmUgdGhlIGFwcGxpY2F0aW9uIGFzIGFyZ3ZbMF1cbiAgICogYW5kIHRoZSBzY3JpcHQgYmVpbmcgcnVuIGluIGFyZ3ZbMV0sIHdpdGggdXNlciBwYXJhbWV0ZXJzIGFmdGVyIHRoYXQuXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIHByb2dyYW0ucGFyc2UocHJvY2Vzcy5hcmd2KTtcbiAgICogcHJvZ3JhbS5wYXJzZSgpOyAvLyBpbXBsaWNpdGx5IHVzZSBwcm9jZXNzLmFyZ3YgYW5kIGF1dG8tZGV0ZWN0IG5vZGUgdnMgZWxlY3Ryb24gY29udmVudGlvbnNcbiAgICogcHJvZ3JhbS5wYXJzZShteS1hcmdzLCB7IGZyb206ICd1c2VyJyB9KTsgLy8ganVzdCB1c2VyIHN1cHBsaWVkIGFyZ3VtZW50cywgbm90aGluZyBzcGVjaWFsIGFib3V0IGFyZ3ZbMF1cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3ZdIC0gb3B0aW9uYWwsIGRlZmF1bHRzIHRvIHByb2Nlc3MuYXJndlxuICAgKiBAcGFyYW0ge09iamVjdH0gW3BhcnNlT3B0aW9uc10gLSBvcHRpb25hbGx5IHNwZWNpZnkgc3R5bGUgb2Ygb3B0aW9ucyB3aXRoIGZyb206IG5vZGUvdXNlci9lbGVjdHJvblxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3BhcnNlT3B0aW9ucy5mcm9tXSAtIHdoZXJlIHRoZSBhcmdzIGFyZSBmcm9tOiAnbm9kZScsICd1c2VyJywgJ2VsZWN0cm9uJ1xuICAgKiBAcmV0dXJuIHtDb21tYW5kfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmdcbiAgICovXG5cbiAgcGFyc2UoYXJndiwgcGFyc2VPcHRpb25zKSB7XG4gICAgY29uc3QgdXNlckFyZ3MgPSB0aGlzLl9wcmVwYXJlVXNlckFyZ3MoYXJndiwgcGFyc2VPcHRpb25zKTtcbiAgICB0aGlzLl9wYXJzZUNvbW1hbmQoW10sIHVzZXJBcmdzKTtcblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlIGBhcmd2YCwgc2V0dGluZyBvcHRpb25zIGFuZCBpbnZva2luZyBjb21tYW5kcyB3aGVuIGRlZmluZWQuXG4gICAqXG4gICAqIFVzZSBwYXJzZUFzeW5jIGluc3RlYWQgb2YgcGFyc2UgaWYgYW55IG9mIHlvdXIgYWN0aW9uIGhhbmRsZXJzIGFyZSBhc3luYy4gUmV0dXJucyBhIFByb21pc2UuXG4gICAqXG4gICAqIFRoZSBkZWZhdWx0IGV4cGVjdGF0aW9uIGlzIHRoYXQgdGhlIGFyZ3VtZW50cyBhcmUgZnJvbSBub2RlIGFuZCBoYXZlIHRoZSBhcHBsaWNhdGlvbiBhcyBhcmd2WzBdXG4gICAqIGFuZCB0aGUgc2NyaXB0IGJlaW5nIHJ1biBpbiBhcmd2WzFdLCB3aXRoIHVzZXIgcGFyYW1ldGVycyBhZnRlciB0aGF0LlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBhd2FpdCBwcm9ncmFtLnBhcnNlQXN5bmMocHJvY2Vzcy5hcmd2KTtcbiAgICogYXdhaXQgcHJvZ3JhbS5wYXJzZUFzeW5jKCk7IC8vIGltcGxpY2l0bHkgdXNlIHByb2Nlc3MuYXJndiBhbmQgYXV0by1kZXRlY3Qgbm9kZSB2cyBlbGVjdHJvbiBjb252ZW50aW9uc1xuICAgKiBhd2FpdCBwcm9ncmFtLnBhcnNlQXN5bmMobXktYXJncywgeyBmcm9tOiAndXNlcicgfSk7IC8vIGp1c3QgdXNlciBzdXBwbGllZCBhcmd1bWVudHMsIG5vdGhpbmcgc3BlY2lhbCBhYm91dCBhcmd2WzBdXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmd2XVxuICAgKiBAcGFyYW0ge09iamVjdH0gW3BhcnNlT3B0aW9uc11cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBhcnNlT3B0aW9ucy5mcm9tIC0gd2hlcmUgdGhlIGFyZ3MgYXJlIGZyb206ICdub2RlJywgJ3VzZXInLCAnZWxlY3Ryb24nXG4gICAqIEByZXR1cm4ge1Byb21pc2V9XG4gICAqL1xuXG4gIGFzeW5jIHBhcnNlQXN5bmMoYXJndiwgcGFyc2VPcHRpb25zKSB7XG4gICAgY29uc3QgdXNlckFyZ3MgPSB0aGlzLl9wcmVwYXJlVXNlckFyZ3MoYXJndiwgcGFyc2VPcHRpb25zKTtcbiAgICBhd2FpdCB0aGlzLl9wYXJzZUNvbW1hbmQoW10sIHVzZXJBcmdzKTtcblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGUgYSBzdWItY29tbWFuZCBleGVjdXRhYmxlLlxuICAgKlxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgX2V4ZWN1dGVTdWJDb21tYW5kKHN1YmNvbW1hbmQsIGFyZ3MpIHtcbiAgICBhcmdzID0gYXJncy5zbGljZSgpO1xuICAgIGxldCBsYXVuY2hXaXRoTm9kZSA9IGZhbHNlOyAvLyBVc2Ugbm9kZSBmb3Igc291cmNlIHRhcmdldHMgc28gZG8gbm90IG5lZWQgdG8gZ2V0IHBlcm1pc3Npb25zIGNvcnJlY3QsIGFuZCBvbiBXaW5kb3dzLlxuICAgIGNvbnN0IHNvdXJjZUV4dCA9IFsnLmpzJywgJy50cycsICcudHN4JywgJy5tanMnLCAnLmNqcyddO1xuXG4gICAgZnVuY3Rpb24gZmluZEZpbGUoYmFzZURpciwgYmFzZU5hbWUpIHtcbiAgICAgIC8vIExvb2sgZm9yIHNwZWNpZmllZCBmaWxlXG4gICAgICBjb25zdCBsb2NhbEJpbiA9IHBhdGgucmVzb2x2ZShiYXNlRGlyLCBiYXNlTmFtZSk7XG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhsb2NhbEJpbikpIHJldHVybiBsb2NhbEJpbjtcblxuICAgICAgLy8gU3RvcCBsb29raW5nIGlmIGNhbmRpZGF0ZSBhbHJlYWR5IGhhcyBhbiBleHBlY3RlZCBleHRlbnNpb24uXG4gICAgICBpZiAoc291cmNlRXh0LmluY2x1ZGVzKHBhdGguZXh0bmFtZShiYXNlTmFtZSkpKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICAvLyBUcnkgYWxsIHRoZSBleHRlbnNpb25zLlxuICAgICAgY29uc3QgZm91bmRFeHQgPSBzb3VyY2VFeHQuZmluZChleHQgPT4gZnMuZXhpc3RzU3luYyhgJHtsb2NhbEJpbn0ke2V4dH1gKSk7XG4gICAgICBpZiAoZm91bmRFeHQpIHJldHVybiBgJHtsb2NhbEJpbn0ke2ZvdW5kRXh0fWA7XG5cbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gTm90IGNoZWNraW5nIGZvciBoZWxwIGZpcnN0LiBVbmxpa2VseSB0byBoYXZlIG1hbmRhdG9yeSBhbmQgZXhlY3V0YWJsZSwgYW5kIGNhbid0IHJvYnVzdGx5IHRlc3QgZm9yIGhlbHAgZmxhZ3MgaW4gZXh0ZXJuYWwgY29tbWFuZC5cbiAgICB0aGlzLl9jaGVja0Zvck1pc3NpbmdNYW5kYXRvcnlPcHRpb25zKCk7XG4gICAgdGhpcy5fY2hlY2tGb3JDb25mbGljdGluZ09wdGlvbnMoKTtcblxuICAgIC8vIGV4ZWN1dGFibGVGaWxlIGFuZCBleGVjdXRhYmxlRGlyIG1pZ2h0IGJlIGZ1bGwgcGF0aCwgb3IganVzdCBhIG5hbWVcbiAgICBsZXQgZXhlY3V0YWJsZUZpbGUgPSBzdWJjb21tYW5kLl9leGVjdXRhYmxlRmlsZSB8fCBgJHt0aGlzLl9uYW1lfS0ke3N1YmNvbW1hbmQuX25hbWV9YDtcbiAgICBsZXQgZXhlY3V0YWJsZURpciA9IHRoaXMuX2V4ZWN1dGFibGVEaXIgfHwgJyc7XG4gICAgaWYgKHRoaXMuX3NjcmlwdFBhdGgpIHtcbiAgICAgIGxldCByZXNvbHZlZFNjcmlwdFBhdGg7IC8vIHJlc29sdmUgcG9zc2libGUgc3ltbGluayBmb3IgaW5zdGFsbGVkIG5wbSBiaW5hcnlcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlc29sdmVkU2NyaXB0UGF0aCA9IGZzLnJlYWxwYXRoU3luYyh0aGlzLl9zY3JpcHRQYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZXNvbHZlZFNjcmlwdFBhdGggPSB0aGlzLl9zY3JpcHRQYXRoO1xuICAgICAgfVxuICAgICAgZXhlY3V0YWJsZURpciA9IHBhdGgucmVzb2x2ZShwYXRoLmRpcm5hbWUocmVzb2x2ZWRTY3JpcHRQYXRoKSwgZXhlY3V0YWJsZURpcik7XG4gICAgfVxuXG4gICAgLy8gTG9vayBmb3IgYSBsb2NhbCBmaWxlIGluIHByZWZlcmVuY2UgdG8gYSBjb21tYW5kIGluIFBBVEguXG4gICAgaWYgKGV4ZWN1dGFibGVEaXIpIHtcbiAgICAgIGxldCBsb2NhbEZpbGUgPSBmaW5kRmlsZShleGVjdXRhYmxlRGlyLCBleGVjdXRhYmxlRmlsZSk7XG5cbiAgICAgIC8vIExlZ2FjeSBzZWFyY2ggdXNpbmcgcHJlZml4IG9mIHNjcmlwdCBuYW1lIGluc3RlYWQgb2YgY29tbWFuZCBuYW1lXG4gICAgICBpZiAoIWxvY2FsRmlsZSAmJiAhc3ViY29tbWFuZC5fZXhlY3V0YWJsZUZpbGUgJiYgdGhpcy5fc2NyaXB0UGF0aCkge1xuICAgICAgICBjb25zdCBsZWdhY3lOYW1lID0gcGF0aC5iYXNlbmFtZSh0aGlzLl9zY3JpcHRQYXRoLCBwYXRoLmV4dG5hbWUodGhpcy5fc2NyaXB0UGF0aCkpO1xuICAgICAgICBpZiAobGVnYWN5TmFtZSAhPT0gdGhpcy5fbmFtZSkge1xuICAgICAgICAgIGxvY2FsRmlsZSA9IGZpbmRGaWxlKGV4ZWN1dGFibGVEaXIsIGAke2xlZ2FjeU5hbWV9LSR7c3ViY29tbWFuZC5fbmFtZX1gKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZXhlY3V0YWJsZUZpbGUgPSBsb2NhbEZpbGUgfHwgZXhlY3V0YWJsZUZpbGU7XG4gICAgfVxuXG4gICAgbGF1bmNoV2l0aE5vZGUgPSBzb3VyY2VFeHQuaW5jbHVkZXMocGF0aC5leHRuYW1lKGV4ZWN1dGFibGVGaWxlKSk7XG5cbiAgICBsZXQgcHJvYztcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSAhPT0gJ3dpbjMyJykge1xuICAgICAgaWYgKGxhdW5jaFdpdGhOb2RlKSB7XG4gICAgICAgIGFyZ3MudW5zaGlmdChleGVjdXRhYmxlRmlsZSk7XG4gICAgICAgIC8vIGFkZCBleGVjdXRhYmxlIGFyZ3VtZW50cyB0byBzcGF3blxuICAgICAgICBhcmdzID0gaW5jcmVtZW50Tm9kZUluc3BlY3RvclBvcnQocHJvY2Vzcy5leGVjQXJndikuY29uY2F0KGFyZ3MpO1xuXG4gICAgICAgIHByb2MgPSBjaGlsZFByb2Nlc3Muc3Bhd24ocHJvY2Vzcy5hcmd2WzBdLCBhcmdzLCB7IHN0ZGlvOiAnaW5oZXJpdCcgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcm9jID0gY2hpbGRQcm9jZXNzLnNwYXduKGV4ZWN1dGFibGVGaWxlLCBhcmdzLCB7IHN0ZGlvOiAnaW5oZXJpdCcgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZ3MudW5zaGlmdChleGVjdXRhYmxlRmlsZSk7XG4gICAgICAvLyBhZGQgZXhlY3V0YWJsZSBhcmd1bWVudHMgdG8gc3Bhd25cbiAgICAgIGFyZ3MgPSBpbmNyZW1lbnROb2RlSW5zcGVjdG9yUG9ydChwcm9jZXNzLmV4ZWNBcmd2KS5jb25jYXQoYXJncyk7XG4gICAgICBwcm9jID0gY2hpbGRQcm9jZXNzLnNwYXduKHByb2Nlc3MuZXhlY1BhdGgsIGFyZ3MsIHsgc3RkaW86ICdpbmhlcml0JyB9KTtcbiAgICB9XG5cbiAgICBpZiAoIXByb2Mua2lsbGVkKSB7IC8vIHRlc3RpbmcgbWFpbmx5IHRvIGF2b2lkIGxlYWsgd2FybmluZ3MgZHVyaW5nIHVuaXQgdGVzdHMgd2l0aCBtb2NrZWQgc3Bhd25cbiAgICAgIGNvbnN0IHNpZ25hbHMgPSBbJ1NJR1VTUjEnLCAnU0lHVVNSMicsICdTSUdURVJNJywgJ1NJR0lOVCcsICdTSUdIVVAnXTtcbiAgICAgIHNpZ25hbHMuZm9yRWFjaCgoc2lnbmFsKSA9PiB7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcHJvY2Vzcy5vbihzaWduYWwsICgpID0+IHtcbiAgICAgICAgICBpZiAocHJvYy5raWxsZWQgPT09IGZhbHNlICYmIHByb2MuZXhpdENvZGUgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHByb2Mua2lsbChzaWduYWwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBCeSBkZWZhdWx0IHRlcm1pbmF0ZSBwcm9jZXNzIHdoZW4gc3Bhd25lZCBwcm9jZXNzIHRlcm1pbmF0ZXMuXG4gICAgLy8gU3VwcHJlc3NpbmcgdGhlIGV4aXQgaWYgZXhpdENhbGxiYWNrIGRlZmluZWQgaXMgYSBiaXQgbWVzc3kgYW5kIG9mIGxpbWl0ZWQgdXNlLCBidXQgZG9lcyBhbGxvdyBwcm9jZXNzIHRvIHN0YXkgcnVubmluZyFcbiAgICBjb25zdCBleGl0Q2FsbGJhY2sgPSB0aGlzLl9leGl0Q2FsbGJhY2s7XG4gICAgaWYgKCFleGl0Q2FsbGJhY2spIHtcbiAgICAgIHByb2Mub24oJ2Nsb3NlJywgcHJvY2Vzcy5leGl0LmJpbmQocHJvY2VzcykpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwcm9jLm9uKCdjbG9zZScsICgpID0+IHtcbiAgICAgICAgZXhpdENhbGxiYWNrKG5ldyBDb21tYW5kZXJFcnJvcihwcm9jZXNzLmV4aXRDb2RlIHx8IDAsICdjb21tYW5kZXIuZXhlY3V0ZVN1YkNvbW1hbmRBc3luYycsICcoY2xvc2UpJykpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHByb2Mub24oJ2Vycm9yJywgKGVycikgPT4ge1xuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKGVyci5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgICBjb25zdCBleGVjdXRhYmxlRGlyTWVzc2FnZSA9IGV4ZWN1dGFibGVEaXJcbiAgICAgICAgICA/IGBzZWFyY2hlZCBmb3IgbG9jYWwgc3ViY29tbWFuZCByZWxhdGl2ZSB0byBkaXJlY3RvcnkgJyR7ZXhlY3V0YWJsZURpcn0nYFxuICAgICAgICAgIDogJ25vIGRpcmVjdG9yeSBmb3Igc2VhcmNoIGZvciBsb2NhbCBzdWJjb21tYW5kLCB1c2UgLmV4ZWN1dGFibGVEaXIoKSB0byBzdXBwbHkgYSBjdXN0b20gZGlyZWN0b3J5JztcbiAgICAgICAgY29uc3QgZXhlY3V0YWJsZU1pc3NpbmcgPSBgJyR7ZXhlY3V0YWJsZUZpbGV9JyBkb2VzIG5vdCBleGlzdFxuIC0gaWYgJyR7c3ViY29tbWFuZC5fbmFtZX0nIGlzIG5vdCBtZWFudCB0byBiZSBhbiBleGVjdXRhYmxlIGNvbW1hbmQsIHJlbW92ZSBkZXNjcmlwdGlvbiBwYXJhbWV0ZXIgZnJvbSAnLmNvbW1hbmQoKScgYW5kIHVzZSAnLmRlc2NyaXB0aW9uKCknIGluc3RlYWRcbiAtIGlmIHRoZSBkZWZhdWx0IGV4ZWN1dGFibGUgbmFtZSBpcyBub3Qgc3VpdGFibGUsIHVzZSB0aGUgZXhlY3V0YWJsZUZpbGUgb3B0aW9uIHRvIHN1cHBseSBhIGN1c3RvbSBuYW1lIG9yIHBhdGhcbiAtICR7ZXhlY3V0YWJsZURpck1lc3NhZ2V9YDtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGV4ZWN1dGFibGVNaXNzaW5nKTtcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIH0gZWxzZSBpZiAoZXJyLmNvZGUgPT09ICdFQUNDRVMnKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJyR7ZXhlY3V0YWJsZUZpbGV9JyBub3QgZXhlY3V0YWJsZWApO1xuICAgICAgfVxuICAgICAgaWYgKCFleGl0Q2FsbGJhY2spIHtcbiAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgd3JhcHBlZEVycm9yID0gbmV3IENvbW1hbmRlckVycm9yKDEsICdjb21tYW5kZXIuZXhlY3V0ZVN1YkNvbW1hbmRBc3luYycsICcoZXJyb3IpJyk7XG4gICAgICAgIHdyYXBwZWRFcnJvci5uZXN0ZWRFcnJvciA9IGVycjtcbiAgICAgICAgZXhpdENhbGxiYWNrKHdyYXBwZWRFcnJvcik7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTdG9yZSB0aGUgcmVmZXJlbmNlIHRvIHRoZSBjaGlsZCBwcm9jZXNzXG4gICAgdGhpcy5ydW5uaW5nQ29tbWFuZCA9IHByb2M7XG4gIH1cblxuICAvKipcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIF9kaXNwYXRjaFN1YmNvbW1hbmQoY29tbWFuZE5hbWUsIG9wZXJhbmRzLCB1bmtub3duKSB7XG4gICAgY29uc3Qgc3ViQ29tbWFuZCA9IHRoaXMuX2ZpbmRDb21tYW5kKGNvbW1hbmROYW1lKTtcbiAgICBpZiAoIXN1YkNvbW1hbmQpIHRoaXMuaGVscCh7IGVycm9yOiB0cnVlIH0pO1xuXG4gICAgaWYgKHN1YkNvbW1hbmQuX2V4ZWN1dGFibGVIYW5kbGVyKSB7XG4gICAgICB0aGlzLl9leGVjdXRlU3ViQ29tbWFuZChzdWJDb21tYW5kLCBvcGVyYW5kcy5jb25jYXQodW5rbm93bikpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gc3ViQ29tbWFuZC5fcGFyc2VDb21tYW5kKG9wZXJhbmRzLCB1bmtub3duKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgdGhpcy5hcmdzIGFnYWluc3QgZXhwZWN0ZWQgdGhpcy5fYXJncy5cbiAgICpcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIF9jaGVja051bWJlck9mQXJndW1lbnRzKCkge1xuICAgIC8vIHRvbyBmZXdcbiAgICB0aGlzLl9hcmdzLmZvckVhY2goKGFyZywgaSkgPT4ge1xuICAgICAgaWYgKGFyZy5yZXF1aXJlZCAmJiB0aGlzLmFyZ3NbaV0gPT0gbnVsbCkge1xuICAgICAgICB0aGlzLm1pc3NpbmdBcmd1bWVudChhcmcubmFtZSgpKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyB0b28gbWFueVxuICAgIGlmICh0aGlzLl9hcmdzLmxlbmd0aCA+IDAgJiYgdGhpcy5fYXJnc1t0aGlzLl9hcmdzLmxlbmd0aCAtIDFdLnZhcmlhZGljKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmFyZ3MubGVuZ3RoID4gdGhpcy5fYXJncy5sZW5ndGgpIHtcbiAgICAgIHRoaXMuX2V4Y2Vzc0FyZ3VtZW50cyh0aGlzLmFyZ3MpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIHRoaXMuYXJncyB1c2luZyB0aGlzLl9hcmdzIGFuZCBzYXZlIGFzIHRoaXMucHJvY2Vzc2VkQXJncyFcbiAgICpcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIF9wcm9jZXNzQXJndW1lbnRzKCkge1xuICAgIGNvbnN0IG15UGFyc2VBcmcgPSAoYXJndW1lbnQsIHZhbHVlLCBwcmV2aW91cykgPT4ge1xuICAgICAgLy8gRXh0cmEgcHJvY2Vzc2luZyBmb3IgbmljZSBlcnJvciBtZXNzYWdlIG9uIHBhcnNpbmcgZmFpbHVyZS5cbiAgICAgIGxldCBwYXJzZWRWYWx1ZSA9IHZhbHVlO1xuICAgICAgaWYgKHZhbHVlICE9PSBudWxsICYmIGFyZ3VtZW50LnBhcnNlQXJnKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcGFyc2VkVmFsdWUgPSBhcmd1bWVudC5wYXJzZUFyZyh2YWx1ZSwgcHJldmlvdXMpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBpZiAoZXJyLmNvZGUgPT09ICdjb21tYW5kZXIuaW52YWxpZEFyZ3VtZW50Jykge1xuICAgICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGBlcnJvcjogY29tbWFuZC1hcmd1bWVudCB2YWx1ZSAnJHt2YWx1ZX0nIGlzIGludmFsaWQgZm9yIGFyZ3VtZW50ICcke2FyZ3VtZW50Lm5hbWUoKX0nLiAke2Vyci5tZXNzYWdlfWA7XG4gICAgICAgICAgICB0aGlzLmVycm9yKG1lc3NhZ2UsIHsgZXhpdENvZGU6IGVyci5leGl0Q29kZSwgY29kZTogZXJyLmNvZGUgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlZFZhbHVlO1xuICAgIH07XG5cbiAgICB0aGlzLl9jaGVja051bWJlck9mQXJndW1lbnRzKCk7XG5cbiAgICBjb25zdCBwcm9jZXNzZWRBcmdzID0gW107XG4gICAgdGhpcy5fYXJncy5mb3JFYWNoKChkZWNsYXJlZEFyZywgaW5kZXgpID0+IHtcbiAgICAgIGxldCB2YWx1ZSA9IGRlY2xhcmVkQXJnLmRlZmF1bHRWYWx1ZTtcbiAgICAgIGlmIChkZWNsYXJlZEFyZy52YXJpYWRpYykge1xuICAgICAgICAvLyBDb2xsZWN0IHRvZ2V0aGVyIHJlbWFpbmluZyBhcmd1bWVudHMgZm9yIHBhc3NpbmcgdG9nZXRoZXIgYXMgYW4gYXJyYXkuXG4gICAgICAgIGlmIChpbmRleCA8IHRoaXMuYXJncy5sZW5ndGgpIHtcbiAgICAgICAgICB2YWx1ZSA9IHRoaXMuYXJncy5zbGljZShpbmRleCk7XG4gICAgICAgICAgaWYgKGRlY2xhcmVkQXJnLnBhcnNlQXJnKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IHZhbHVlLnJlZHVjZSgocHJvY2Vzc2VkLCB2KSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBteVBhcnNlQXJnKGRlY2xhcmVkQXJnLCB2LCBwcm9jZXNzZWQpO1xuICAgICAgICAgICAgfSwgZGVjbGFyZWRBcmcuZGVmYXVsdFZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHZhbHVlID0gW107XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoaW5kZXggPCB0aGlzLmFyZ3MubGVuZ3RoKSB7XG4gICAgICAgIHZhbHVlID0gdGhpcy5hcmdzW2luZGV4XTtcbiAgICAgICAgaWYgKGRlY2xhcmVkQXJnLnBhcnNlQXJnKSB7XG4gICAgICAgICAgdmFsdWUgPSBteVBhcnNlQXJnKGRlY2xhcmVkQXJnLCB2YWx1ZSwgZGVjbGFyZWRBcmcuZGVmYXVsdFZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcHJvY2Vzc2VkQXJnc1tpbmRleF0gPSB2YWx1ZTtcbiAgICB9KTtcbiAgICB0aGlzLnByb2Nlc3NlZEFyZ3MgPSBwcm9jZXNzZWRBcmdzO1xuICB9XG5cbiAgLyoqXG4gICAqIE9uY2Ugd2UgaGF2ZSBhIHByb21pc2Ugd2UgY2hhaW4sIGJ1dCBjYWxsIHN5bmNocm9ub3VzbHkgdW50aWwgdGhlbi5cbiAgICpcbiAgICogQHBhcmFtIHtQcm9taXNlfHVuZGVmaW5lZH0gcHJvbWlzZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICAgKiBAcmV0dXJuIHtQcm9taXNlfHVuZGVmaW5lZH1cbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIF9jaGFpbk9yQ2FsbChwcm9taXNlLCBmbikge1xuICAgIC8vIHRoZW5hYmxlXG4gICAgaWYgKHByb21pc2UgJiYgcHJvbWlzZS50aGVuICYmIHR5cGVvZiBwcm9taXNlLnRoZW4gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIGFscmVhZHkgaGF2ZSBhIHByb21pc2UsIGNoYWluIGNhbGxiYWNrXG4gICAgICByZXR1cm4gcHJvbWlzZS50aGVuKCgpID0+IGZuKCkpO1xuICAgIH1cbiAgICAvLyBjYWxsYmFjayBtaWdodCByZXR1cm4gYSBwcm9taXNlXG4gICAgcmV0dXJuIGZuKCk7XG4gIH1cblxuICAvKipcbiAgICpcbiAgICogQHBhcmFtIHtQcm9taXNlfHVuZGVmaW5lZH0gcHJvbWlzZVxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnRcbiAgICogQHJldHVybiB7UHJvbWlzZXx1bmRlZmluZWR9XG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cblxuICBfY2hhaW5PckNhbGxIb29rcyhwcm9taXNlLCBldmVudCkge1xuICAgIGxldCByZXN1bHQgPSBwcm9taXNlO1xuICAgIGNvbnN0IGhvb2tzID0gW107XG4gICAgZ2V0Q29tbWFuZEFuZFBhcmVudHModGhpcylcbiAgICAgIC5yZXZlcnNlKClcbiAgICAgIC5maWx0ZXIoY21kID0+IGNtZC5fbGlmZUN5Y2xlSG9va3NbZXZlbnRdICE9PSB1bmRlZmluZWQpXG4gICAgICAuZm9yRWFjaChob29rZWRDb21tYW5kID0+IHtcbiAgICAgICAgaG9va2VkQ29tbWFuZC5fbGlmZUN5Y2xlSG9va3NbZXZlbnRdLmZvckVhY2goKGNhbGxiYWNrKSA9PiB7XG4gICAgICAgICAgaG9va3MucHVzaCh7IGhvb2tlZENvbW1hbmQsIGNhbGxiYWNrIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIGlmIChldmVudCA9PT0gJ3Bvc3RBY3Rpb24nKSB7XG4gICAgICBob29rcy5yZXZlcnNlKCk7XG4gICAgfVxuXG4gICAgaG9va3MuZm9yRWFjaCgoaG9va0RldGFpbCkgPT4ge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fY2hhaW5PckNhbGwocmVzdWx0LCAoKSA9PiB7XG4gICAgICAgIHJldHVybiBob29rRGV0YWlsLmNhbGxiYWNrKGhvb2tEZXRhaWwuaG9va2VkQ29tbWFuZCwgdGhpcyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3MgYXJndW1lbnRzIGluIGNvbnRleHQgb2YgdGhpcyBjb21tYW5kLlxuICAgKiBSZXR1cm5zIGFjdGlvbiByZXN1bHQsIGluIGNhc2UgaXQgaXMgYSBwcm9taXNlLlxuICAgKlxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgX3BhcnNlQ29tbWFuZChvcGVyYW5kcywgdW5rbm93bikge1xuICAgIGNvbnN0IHBhcnNlZCA9IHRoaXMucGFyc2VPcHRpb25zKHVua25vd24pO1xuICAgIHRoaXMuX3BhcnNlT3B0aW9uc0VudigpOyAvLyBhZnRlciBjbGksIHNvIHBhcnNlQXJnIG5vdCBjYWxsZWQgb24gYm90aCBjbGkgYW5kIGVudlxuICAgIG9wZXJhbmRzID0gb3BlcmFuZHMuY29uY2F0KHBhcnNlZC5vcGVyYW5kcyk7XG4gICAgdW5rbm93biA9IHBhcnNlZC51bmtub3duO1xuICAgIHRoaXMuYXJncyA9IG9wZXJhbmRzLmNvbmNhdCh1bmtub3duKTtcblxuICAgIGlmIChvcGVyYW5kcyAmJiB0aGlzLl9maW5kQ29tbWFuZChvcGVyYW5kc1swXSkpIHtcbiAgICAgIHJldHVybiB0aGlzLl9kaXNwYXRjaFN1YmNvbW1hbmQob3BlcmFuZHNbMF0sIG9wZXJhbmRzLnNsaWNlKDEpLCB1bmtub3duKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuX2hhc0ltcGxpY2l0SGVscENvbW1hbmQoKSAmJiBvcGVyYW5kc1swXSA9PT0gdGhpcy5faGVscENvbW1hbmROYW1lKSB7XG4gICAgICBpZiAob3BlcmFuZHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHRoaXMuaGVscCgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuX2Rpc3BhdGNoU3ViY29tbWFuZChvcGVyYW5kc1sxXSwgW10sIFt0aGlzLl9oZWxwTG9uZ0ZsYWddKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuX2RlZmF1bHRDb21tYW5kTmFtZSkge1xuICAgICAgb3V0cHV0SGVscElmUmVxdWVzdGVkKHRoaXMsIHVua25vd24pOyAvLyBSdW4gdGhlIGhlbHAgZm9yIGRlZmF1bHQgY29tbWFuZCBmcm9tIHBhcmVudCByYXRoZXIgdGhhbiBwYXNzaW5nIHRvIGRlZmF1bHQgY29tbWFuZFxuICAgICAgcmV0dXJuIHRoaXMuX2Rpc3BhdGNoU3ViY29tbWFuZCh0aGlzLl9kZWZhdWx0Q29tbWFuZE5hbWUsIG9wZXJhbmRzLCB1bmtub3duKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29tbWFuZHMubGVuZ3RoICYmIHRoaXMuYXJncy5sZW5ndGggPT09IDAgJiYgIXRoaXMuX2FjdGlvbkhhbmRsZXIgJiYgIXRoaXMuX2RlZmF1bHRDb21tYW5kTmFtZSkge1xuICAgICAgLy8gcHJvYmFibHkgbWlzc2luZyBzdWJjb21tYW5kIGFuZCBubyBoYW5kbGVyLCB1c2VyIG5lZWRzIGhlbHAgKGFuZCBleGl0KVxuICAgICAgdGhpcy5oZWxwKHsgZXJyb3I6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgb3V0cHV0SGVscElmUmVxdWVzdGVkKHRoaXMsIHBhcnNlZC51bmtub3duKTtcbiAgICB0aGlzLl9jaGVja0Zvck1pc3NpbmdNYW5kYXRvcnlPcHRpb25zKCk7XG4gICAgdGhpcy5fY2hlY2tGb3JDb25mbGljdGluZ09wdGlvbnMoKTtcblxuICAgIC8vIFdlIGRvIG5vdCBhbHdheXMgY2FsbCB0aGlzIGNoZWNrIHRvIGF2b2lkIG1hc2tpbmcgYSBcImJldHRlclwiIGVycm9yLCBsaWtlIHVua25vd24gY29tbWFuZC5cbiAgICBjb25zdCBjaGVja0ZvclVua25vd25PcHRpb25zID0gKCkgPT4ge1xuICAgICAgaWYgKHBhcnNlZC51bmtub3duLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhpcy51bmtub3duT3B0aW9uKHBhcnNlZC51bmtub3duWzBdKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgY29uc3QgY29tbWFuZEV2ZW50ID0gYGNvbW1hbmQ6JHt0aGlzLm5hbWUoKX1gO1xuICAgIGlmICh0aGlzLl9hY3Rpb25IYW5kbGVyKSB7XG4gICAgICBjaGVja0ZvclVua25vd25PcHRpb25zKCk7XG4gICAgICB0aGlzLl9wcm9jZXNzQXJndW1lbnRzKCk7XG5cbiAgICAgIGxldCBhY3Rpb25SZXN1bHQ7XG4gICAgICBhY3Rpb25SZXN1bHQgPSB0aGlzLl9jaGFpbk9yQ2FsbEhvb2tzKGFjdGlvblJlc3VsdCwgJ3ByZUFjdGlvbicpO1xuICAgICAgYWN0aW9uUmVzdWx0ID0gdGhpcy5fY2hhaW5PckNhbGwoYWN0aW9uUmVzdWx0LCAoKSA9PiB0aGlzLl9hY3Rpb25IYW5kbGVyKHRoaXMucHJvY2Vzc2VkQXJncykpO1xuICAgICAgaWYgKHRoaXMucGFyZW50KSB7XG4gICAgICAgIGFjdGlvblJlc3VsdCA9IHRoaXMuX2NoYWluT3JDYWxsKGFjdGlvblJlc3VsdCwgKCkgPT4ge1xuICAgICAgICAgIHRoaXMucGFyZW50LmVtaXQoY29tbWFuZEV2ZW50LCBvcGVyYW5kcywgdW5rbm93bik7IC8vIGxlZ2FjeVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGFjdGlvblJlc3VsdCA9IHRoaXMuX2NoYWluT3JDYWxsSG9va3MoYWN0aW9uUmVzdWx0LCAncG9zdEFjdGlvbicpO1xuICAgICAgcmV0dXJuIGFjdGlvblJlc3VsdDtcbiAgICB9XG4gICAgaWYgKHRoaXMucGFyZW50ICYmIHRoaXMucGFyZW50Lmxpc3RlbmVyQ291bnQoY29tbWFuZEV2ZW50KSkge1xuICAgICAgY2hlY2tGb3JVbmtub3duT3B0aW9ucygpO1xuICAgICAgdGhpcy5fcHJvY2Vzc0FyZ3VtZW50cygpO1xuICAgICAgdGhpcy5wYXJlbnQuZW1pdChjb21tYW5kRXZlbnQsIG9wZXJhbmRzLCB1bmtub3duKTsgLy8gbGVnYWN5XG4gICAgfSBlbHNlIGlmIChvcGVyYW5kcy5sZW5ndGgpIHtcbiAgICAgIGlmICh0aGlzLl9maW5kQ29tbWFuZCgnKicpKSB7IC8vIGxlZ2FjeSBkZWZhdWx0IGNvbW1hbmRcbiAgICAgICAgcmV0dXJuIHRoaXMuX2Rpc3BhdGNoU3ViY29tbWFuZCgnKicsIG9wZXJhbmRzLCB1bmtub3duKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmxpc3RlbmVyQ291bnQoJ2NvbW1hbmQ6KicpKSB7XG4gICAgICAgIC8vIHNraXAgb3B0aW9uIGNoZWNrLCBlbWl0IGV2ZW50IGZvciBwb3NzaWJsZSBtaXNzcGVsbGluZyBzdWdnZXN0aW9uXG4gICAgICAgIHRoaXMuZW1pdCgnY29tbWFuZDoqJywgb3BlcmFuZHMsIHVua25vd24pO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLmNvbW1hbmRzLmxlbmd0aCkge1xuICAgICAgICB0aGlzLnVua25vd25Db21tYW5kKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjaGVja0ZvclVua25vd25PcHRpb25zKCk7XG4gICAgICAgIHRoaXMuX3Byb2Nlc3NBcmd1bWVudHMoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuY29tbWFuZHMubGVuZ3RoKSB7XG4gICAgICBjaGVja0ZvclVua25vd25PcHRpb25zKCk7XG4gICAgICAvLyBUaGlzIGNvbW1hbmQgaGFzIHN1YmNvbW1hbmRzIGFuZCBub3RoaW5nIGhvb2tlZCB1cCBhdCB0aGlzIGxldmVsLCBzbyBkaXNwbGF5IGhlbHAgKGFuZCBleGl0KS5cbiAgICAgIHRoaXMuaGVscCh7IGVycm9yOiB0cnVlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBjaGVja0ZvclVua25vd25PcHRpb25zKCk7XG4gICAgICB0aGlzLl9wcm9jZXNzQXJndW1lbnRzKCk7XG4gICAgICAvLyBmYWxsIHRocm91Z2ggZm9yIGNhbGxlciB0byBoYW5kbGUgYWZ0ZXIgY2FsbGluZyAucGFyc2UoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kIG1hdGNoaW5nIGNvbW1hbmQuXG4gICAqXG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cbiAgX2ZpbmRDb21tYW5kKG5hbWUpIHtcbiAgICBpZiAoIW5hbWUpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIHRoaXMuY29tbWFuZHMuZmluZChjbWQgPT4gY21kLl9uYW1lID09PSBuYW1lIHx8IGNtZC5fYWxpYXNlcy5pbmNsdWRlcyhuYW1lKSk7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIGFuIG9wdGlvbiBtYXRjaGluZyBgYXJnYCBpZiBhbnkuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdcbiAgICogQHJldHVybiB7T3B0aW9ufVxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgX2ZpbmRPcHRpb24oYXJnKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5maW5kKG9wdGlvbiA9PiBvcHRpb24uaXMoYXJnKSk7XG4gIH1cblxuICAvKipcbiAgICogRGlzcGxheSBhbiBlcnJvciBtZXNzYWdlIGlmIGEgbWFuZGF0b3J5IG9wdGlvbiBkb2VzIG5vdCBoYXZlIGEgdmFsdWUuXG4gICAqIENhbGxlZCBhZnRlciBjaGVja2luZyBmb3IgaGVscCBmbGFncyBpbiBsZWFmIHN1YmNvbW1hbmQuXG4gICAqXG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cblxuICBfY2hlY2tGb3JNaXNzaW5nTWFuZGF0b3J5T3B0aW9ucygpIHtcbiAgICAvLyBXYWxrIHVwIGhpZXJhcmNoeSBzbyBjYW4gY2FsbCBpbiBzdWJjb21tYW5kIGFmdGVyIGNoZWNraW5nIGZvciBkaXNwbGF5aW5nIGhlbHAuXG4gICAgZm9yIChsZXQgY21kID0gdGhpczsgY21kOyBjbWQgPSBjbWQucGFyZW50KSB7XG4gICAgICBjbWQub3B0aW9ucy5mb3JFYWNoKChhbk9wdGlvbikgPT4ge1xuICAgICAgICBpZiAoYW5PcHRpb24ubWFuZGF0b3J5ICYmIChjbWQuZ2V0T3B0aW9uVmFsdWUoYW5PcHRpb24uYXR0cmlidXRlTmFtZSgpKSA9PT0gdW5kZWZpbmVkKSkge1xuICAgICAgICAgIGNtZC5taXNzaW5nTWFuZGF0b3J5T3B0aW9uVmFsdWUoYW5PcHRpb24pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGlzcGxheSBhbiBlcnJvciBtZXNzYWdlIGlmIGNvbmZsaWN0aW5nIG9wdGlvbnMgYXJlIHVzZWQgdG9nZXRoZXIgaW4gdGhpcy5cbiAgICpcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuICBfY2hlY2tGb3JDb25mbGljdGluZ0xvY2FsT3B0aW9ucygpIHtcbiAgICBjb25zdCBkZWZpbmVkTm9uRGVmYXVsdE9wdGlvbnMgPSB0aGlzLm9wdGlvbnMuZmlsdGVyKFxuICAgICAgKG9wdGlvbikgPT4ge1xuICAgICAgICBjb25zdCBvcHRpb25LZXkgPSBvcHRpb24uYXR0cmlidXRlTmFtZSgpO1xuICAgICAgICBpZiAodGhpcy5nZXRPcHRpb25WYWx1ZShvcHRpb25LZXkpID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0T3B0aW9uVmFsdWVTb3VyY2Uob3B0aW9uS2V5KSAhPT0gJ2RlZmF1bHQnO1xuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBvcHRpb25zV2l0aENvbmZsaWN0aW5nID0gZGVmaW5lZE5vbkRlZmF1bHRPcHRpb25zLmZpbHRlcihcbiAgICAgIChvcHRpb24pID0+IG9wdGlvbi5jb25mbGljdHNXaXRoLmxlbmd0aCA+IDBcbiAgICApO1xuXG4gICAgb3B0aW9uc1dpdGhDb25mbGljdGluZy5mb3JFYWNoKChvcHRpb24pID0+IHtcbiAgICAgIGNvbnN0IGNvbmZsaWN0aW5nQW5kRGVmaW5lZCA9IGRlZmluZWROb25EZWZhdWx0T3B0aW9ucy5maW5kKChkZWZpbmVkKSA9PlxuICAgICAgICBvcHRpb24uY29uZmxpY3RzV2l0aC5pbmNsdWRlcyhkZWZpbmVkLmF0dHJpYnV0ZU5hbWUoKSlcbiAgICAgICk7XG4gICAgICBpZiAoY29uZmxpY3RpbmdBbmREZWZpbmVkKSB7XG4gICAgICAgIHRoaXMuX2NvbmZsaWN0aW5nT3B0aW9uKG9wdGlvbiwgY29uZmxpY3RpbmdBbmREZWZpbmVkKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwbGF5IGFuIGVycm9yIG1lc3NhZ2UgaWYgY29uZmxpY3Rpbmcgb3B0aW9ucyBhcmUgdXNlZCB0b2dldGhlci5cbiAgICogQ2FsbGVkIGFmdGVyIGNoZWNraW5nIGZvciBoZWxwIGZsYWdzIGluIGxlYWYgc3ViY29tbWFuZC5cbiAgICpcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuICBfY2hlY2tGb3JDb25mbGljdGluZ09wdGlvbnMoKSB7XG4gICAgLy8gV2FsayB1cCBoaWVyYXJjaHkgc28gY2FuIGNhbGwgaW4gc3ViY29tbWFuZCBhZnRlciBjaGVja2luZyBmb3IgZGlzcGxheWluZyBoZWxwLlxuICAgIGZvciAobGV0IGNtZCA9IHRoaXM7IGNtZDsgY21kID0gY21kLnBhcmVudCkge1xuICAgICAgY21kLl9jaGVja0ZvckNvbmZsaWN0aW5nTG9jYWxPcHRpb25zKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlIG9wdGlvbnMgZnJvbSBgYXJndmAgcmVtb3Zpbmcga25vd24gb3B0aW9ucyxcbiAgICogYW5kIHJldHVybiBhcmd2IHNwbGl0IGludG8gb3BlcmFuZHMgYW5kIHVua25vd24gYXJndW1lbnRzLlxuICAgKlxuICAgKiBFeGFtcGxlczpcbiAgICpcbiAgICogICAgIGFyZ3YgPT4gb3BlcmFuZHMsIHVua25vd25cbiAgICogICAgIC0ta25vd24ga2trIG9wID0+IFtvcF0sIFtdXG4gICAqICAgICBvcCAtLWtub3duIGtrayA9PiBbb3BdLCBbXVxuICAgKiAgICAgc3ViIC0tdW5rbm93biB1dXUgb3AgPT4gW3N1Yl0sIFstLXVua25vd24gdXV1IG9wXVxuICAgKiAgICAgc3ViIC0tIC0tdW5rbm93biB1dXUgb3AgPT4gW3N1YiAtLXVua25vd24gdXV1IG9wXSwgW11cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmdbXX0gYXJndlxuICAgKiBAcmV0dXJuIHt7b3BlcmFuZHM6IFN0cmluZ1tdLCB1bmtub3duOiBTdHJpbmdbXX19XG4gICAqL1xuXG4gIHBhcnNlT3B0aW9ucyhhcmd2KSB7XG4gICAgY29uc3Qgb3BlcmFuZHMgPSBbXTsgLy8gb3BlcmFuZHMsIG5vdCBvcHRpb25zIG9yIHZhbHVlc1xuICAgIGNvbnN0IHVua25vd24gPSBbXTsgLy8gZmlyc3QgdW5rbm93biBvcHRpb24gYW5kIHJlbWFpbmluZyB1bmtub3duIGFyZ3NcbiAgICBsZXQgZGVzdCA9IG9wZXJhbmRzO1xuICAgIGNvbnN0IGFyZ3MgPSBhcmd2LnNsaWNlKCk7XG5cbiAgICBmdW5jdGlvbiBtYXliZU9wdGlvbihhcmcpIHtcbiAgICAgIHJldHVybiBhcmcubGVuZ3RoID4gMSAmJiBhcmdbMF0gPT09ICctJztcbiAgICB9XG5cbiAgICAvLyBwYXJzZSBvcHRpb25zXG4gICAgbGV0IGFjdGl2ZVZhcmlhZGljT3B0aW9uID0gbnVsbDtcbiAgICB3aGlsZSAoYXJncy5sZW5ndGgpIHtcbiAgICAgIGNvbnN0IGFyZyA9IGFyZ3Muc2hpZnQoKTtcblxuICAgICAgLy8gbGl0ZXJhbFxuICAgICAgaWYgKGFyZyA9PT0gJy0tJykge1xuICAgICAgICBpZiAoZGVzdCA9PT0gdW5rbm93bikgZGVzdC5wdXNoKGFyZyk7XG4gICAgICAgIGRlc3QucHVzaCguLi5hcmdzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGlmIChhY3RpdmVWYXJpYWRpY09wdGlvbiAmJiAhbWF5YmVPcHRpb24oYXJnKSkge1xuICAgICAgICB0aGlzLmVtaXQoYG9wdGlvbjoke2FjdGl2ZVZhcmlhZGljT3B0aW9uLm5hbWUoKX1gLCBhcmcpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGFjdGl2ZVZhcmlhZGljT3B0aW9uID0gbnVsbDtcblxuICAgICAgaWYgKG1heWJlT3B0aW9uKGFyZykpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uID0gdGhpcy5fZmluZE9wdGlvbihhcmcpO1xuICAgICAgICAvLyByZWNvZ25pc2VkIG9wdGlvbiwgY2FsbCBsaXN0ZW5lciB0byBhc3NpZ24gdmFsdWUgd2l0aCBwb3NzaWJsZSBjdXN0b20gcHJvY2Vzc2luZ1xuICAgICAgICBpZiAob3B0aW9uKSB7XG4gICAgICAgICAgaWYgKG9wdGlvbi5yZXF1aXJlZCkge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBhcmdzLnNoaWZ0KCk7XG4gICAgICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgdGhpcy5vcHRpb25NaXNzaW5nQXJndW1lbnQob3B0aW9uKTtcbiAgICAgICAgICAgIHRoaXMuZW1pdChgb3B0aW9uOiR7b3B0aW9uLm5hbWUoKX1gLCB2YWx1ZSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChvcHRpb24ub3B0aW9uYWwpIHtcbiAgICAgICAgICAgIGxldCB2YWx1ZSA9IG51bGw7XG4gICAgICAgICAgICAvLyBoaXN0b3JpY2FsIGJlaGF2aW91ciBpcyBvcHRpb25hbCB2YWx1ZSBpcyBmb2xsb3dpbmcgYXJnIHVubGVzcyBhbiBvcHRpb25cbiAgICAgICAgICAgIGlmIChhcmdzLmxlbmd0aCA+IDAgJiYgIW1heWJlT3B0aW9uKGFyZ3NbMF0pKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gYXJncy5zaGlmdCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5lbWl0KGBvcHRpb246JHtvcHRpb24ubmFtZSgpfWAsIHZhbHVlKTtcbiAgICAgICAgICB9IGVsc2UgeyAvLyBib29sZWFuIGZsYWdcbiAgICAgICAgICAgIHRoaXMuZW1pdChgb3B0aW9uOiR7b3B0aW9uLm5hbWUoKX1gKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYWN0aXZlVmFyaWFkaWNPcHRpb24gPSBvcHRpb24udmFyaWFkaWMgPyBvcHRpb24gOiBudWxsO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIExvb2sgZm9yIGNvbWJvIG9wdGlvbnMgZm9sbG93aW5nIHNpbmdsZSBkYXNoLCBlYXQgZmlyc3Qgb25lIGlmIGtub3duLlxuICAgICAgaWYgKGFyZy5sZW5ndGggPiAyICYmIGFyZ1swXSA9PT0gJy0nICYmIGFyZ1sxXSAhPT0gJy0nKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbiA9IHRoaXMuX2ZpbmRPcHRpb24oYC0ke2FyZ1sxXX1gKTtcbiAgICAgICAgaWYgKG9wdGlvbikge1xuICAgICAgICAgIGlmIChvcHRpb24ucmVxdWlyZWQgfHwgKG9wdGlvbi5vcHRpb25hbCAmJiB0aGlzLl9jb21iaW5lRmxhZ0FuZE9wdGlvbmFsVmFsdWUpKSB7XG4gICAgICAgICAgICAvLyBvcHRpb24gd2l0aCB2YWx1ZSBmb2xsb3dpbmcgaW4gc2FtZSBhcmd1bWVudFxuICAgICAgICAgICAgdGhpcy5lbWl0KGBvcHRpb246JHtvcHRpb24ubmFtZSgpfWAsIGFyZy5zbGljZSgyKSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGJvb2xlYW4gb3B0aW9uLCBlbWl0IGFuZCBwdXQgYmFjayByZW1haW5kZXIgb2YgYXJnIGZvciBmdXJ0aGVyIHByb2Nlc3NpbmdcbiAgICAgICAgICAgIHRoaXMuZW1pdChgb3B0aW9uOiR7b3B0aW9uLm5hbWUoKX1gKTtcbiAgICAgICAgICAgIGFyZ3MudW5zaGlmdChgLSR7YXJnLnNsaWNlKDIpfWApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBMb29rIGZvciBrbm93biBsb25nIGZsYWcgd2l0aCB2YWx1ZSwgbGlrZSAtLWZvbz1iYXJcbiAgICAgIGlmICgvXi0tW149XSs9Ly50ZXN0KGFyZykpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSBhcmcuaW5kZXhPZignPScpO1xuICAgICAgICBjb25zdCBvcHRpb24gPSB0aGlzLl9maW5kT3B0aW9uKGFyZy5zbGljZSgwLCBpbmRleCkpO1xuICAgICAgICBpZiAob3B0aW9uICYmIChvcHRpb24ucmVxdWlyZWQgfHwgb3B0aW9uLm9wdGlvbmFsKSkge1xuICAgICAgICAgIHRoaXMuZW1pdChgb3B0aW9uOiR7b3B0aW9uLm5hbWUoKX1gLCBhcmcuc2xpY2UoaW5kZXggKyAxKSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gTm90IGEgcmVjb2duaXNlZCBvcHRpb24gYnkgdGhpcyBjb21tYW5kLlxuICAgICAgLy8gTWlnaHQgYmUgYSBjb21tYW5kLWFyZ3VtZW50LCBvciBzdWJjb21tYW5kIG9wdGlvbiwgb3IgdW5rbm93biBvcHRpb24sIG9yIGhlbHAgY29tbWFuZCBvciBvcHRpb24uXG5cbiAgICAgIC8vIEFuIHVua25vd24gb3B0aW9uIG1lYW5zIGZ1cnRoZXIgYXJndW1lbnRzIGFsc28gY2xhc3NpZmllZCBhcyB1bmtub3duIHNvIGNhbiBiZSByZXByb2Nlc3NlZCBieSBzdWJjb21tYW5kcy5cbiAgICAgIGlmIChtYXliZU9wdGlvbihhcmcpKSB7XG4gICAgICAgIGRlc3QgPSB1bmtub3duO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB1c2luZyBwb3NpdGlvbmFsT3B0aW9ucywgc3RvcCBwcm9jZXNzaW5nIG91ciBvcHRpb25zIGF0IHN1YmNvbW1hbmQuXG4gICAgICBpZiAoKHRoaXMuX2VuYWJsZVBvc2l0aW9uYWxPcHRpb25zIHx8IHRoaXMuX3Bhc3NUaHJvdWdoT3B0aW9ucykgJiYgb3BlcmFuZHMubGVuZ3RoID09PSAwICYmIHVua25vd24ubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmICh0aGlzLl9maW5kQ29tbWFuZChhcmcpKSB7XG4gICAgICAgICAgb3BlcmFuZHMucHVzaChhcmcpO1xuICAgICAgICAgIGlmIChhcmdzLmxlbmd0aCA+IDApIHVua25vd24ucHVzaCguLi5hcmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIGlmIChhcmcgPT09IHRoaXMuX2hlbHBDb21tYW5kTmFtZSAmJiB0aGlzLl9oYXNJbXBsaWNpdEhlbHBDb21tYW5kKCkpIHtcbiAgICAgICAgICBvcGVyYW5kcy5wdXNoKGFyZyk7XG4gICAgICAgICAgaWYgKGFyZ3MubGVuZ3RoID4gMCkgb3BlcmFuZHMucHVzaCguLi5hcmdzKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9kZWZhdWx0Q29tbWFuZE5hbWUpIHtcbiAgICAgICAgICB1bmtub3duLnB1c2goYXJnKTtcbiAgICAgICAgICBpZiAoYXJncy5sZW5ndGggPiAwKSB1bmtub3duLnB1c2goLi4uYXJncyk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gSWYgdXNpbmcgcGFzc1Rocm91Z2hPcHRpb25zLCBzdG9wIHByb2Nlc3Npbmcgb3B0aW9ucyBhdCBmaXJzdCBjb21tYW5kLWFyZ3VtZW50LlxuICAgICAgaWYgKHRoaXMuX3Bhc3NUaHJvdWdoT3B0aW9ucykge1xuICAgICAgICBkZXN0LnB1c2goYXJnKTtcbiAgICAgICAgaWYgKGFyZ3MubGVuZ3RoID4gMCkgZGVzdC5wdXNoKC4uLmFyZ3MpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgLy8gYWRkIGFyZ1xuICAgICAgZGVzdC5wdXNoKGFyZyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgb3BlcmFuZHMsIHVua25vd24gfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gYW4gb2JqZWN0IGNvbnRhaW5pbmcgbG9jYWwgb3B0aW9uIHZhbHVlcyBhcyBrZXktdmFsdWUgcGFpcnMuXG4gICAqXG4gICAqIEByZXR1cm4ge09iamVjdH1cbiAgICovXG4gIG9wdHMoKSB7XG4gICAgaWYgKHRoaXMuX3N0b3JlT3B0aW9uc0FzUHJvcGVydGllcykge1xuICAgICAgLy8gUHJlc2VydmUgb3JpZ2luYWwgYmVoYXZpb3VyIHNvIGJhY2t3YXJkcyBjb21wYXRpYmxlIHdoZW4gc3RpbGwgdXNpbmcgcHJvcGVydGllc1xuICAgICAgY29uc3QgcmVzdWx0ID0ge307XG4gICAgICBjb25zdCBsZW4gPSB0aGlzLm9wdGlvbnMubGVuZ3RoO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGtleSA9IHRoaXMub3B0aW9uc1tpXS5hdHRyaWJ1dGVOYW1lKCk7XG4gICAgICAgIHJlc3VsdFtrZXldID0ga2V5ID09PSB0aGlzLl92ZXJzaW9uT3B0aW9uTmFtZSA/IHRoaXMuX3ZlcnNpb24gOiB0aGlzW2tleV07XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9vcHRpb25WYWx1ZXM7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIGFuIG9iamVjdCBjb250YWluaW5nIG1lcmdlZCBsb2NhbCBhbmQgZ2xvYmFsIG9wdGlvbiB2YWx1ZXMgYXMga2V5LXZhbHVlIHBhaXJzLlxuICAgKlxuICAgKiBAcmV0dXJuIHtPYmplY3R9XG4gICAqL1xuICBvcHRzV2l0aEdsb2JhbHMoKSB7XG4gICAgLy8gZ2xvYmFscyBvdmVyd3JpdGUgbG9jYWxzXG4gICAgcmV0dXJuIGdldENvbW1hbmRBbmRQYXJlbnRzKHRoaXMpLnJlZHVjZShcbiAgICAgIChjb21iaW5lZE9wdGlvbnMsIGNtZCkgPT4gT2JqZWN0LmFzc2lnbihjb21iaW5lZE9wdGlvbnMsIGNtZC5vcHRzKCkpLFxuICAgICAge31cbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIERpc3BsYXkgZXJyb3IgbWVzc2FnZSBhbmQgZXhpdCAob3IgY2FsbCBleGl0T3ZlcnJpZGUpLlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZVxuICAgKiBAcGFyYW0ge09iamVjdH0gW2Vycm9yT3B0aW9uc11cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtlcnJvck9wdGlvbnMuY29kZV0gLSBhbiBpZCBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBlcnJvclxuICAgKiBAcGFyYW0ge251bWJlcn0gW2Vycm9yT3B0aW9ucy5leGl0Q29kZV0gLSB1c2VkIHdpdGggcHJvY2Vzcy5leGl0XG4gICAqL1xuICBlcnJvcihtZXNzYWdlLCBlcnJvck9wdGlvbnMpIHtcbiAgICAvLyBvdXRwdXQgaGFuZGxpbmdcbiAgICB0aGlzLl9vdXRwdXRDb25maWd1cmF0aW9uLm91dHB1dEVycm9yKGAke21lc3NhZ2V9XFxuYCwgdGhpcy5fb3V0cHV0Q29uZmlndXJhdGlvbi53cml0ZUVycik7XG4gICAgaWYgKHR5cGVvZiB0aGlzLl9zaG93SGVscEFmdGVyRXJyb3IgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0aGlzLl9vdXRwdXRDb25maWd1cmF0aW9uLndyaXRlRXJyKGAke3RoaXMuX3Nob3dIZWxwQWZ0ZXJFcnJvcn1cXG5gKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3Nob3dIZWxwQWZ0ZXJFcnJvcikge1xuICAgICAgdGhpcy5fb3V0cHV0Q29uZmlndXJhdGlvbi53cml0ZUVycignXFxuJyk7XG4gICAgICB0aGlzLm91dHB1dEhlbHAoeyBlcnJvcjogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICAvLyBleGl0IGhhbmRsaW5nXG4gICAgY29uc3QgY29uZmlnID0gZXJyb3JPcHRpb25zIHx8IHt9O1xuICAgIGNvbnN0IGV4aXRDb2RlID0gY29uZmlnLmV4aXRDb2RlIHx8IDE7XG4gICAgY29uc3QgY29kZSA9IGNvbmZpZy5jb2RlIHx8ICdjb21tYW5kZXIuZXJyb3InO1xuICAgIHRoaXMuX2V4aXQoZXhpdENvZGUsIGNvZGUsIG1lc3NhZ2UpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IGFueSBvcHRpb24gcmVsYXRlZCBlbnZpcm9ubWVudCB2YXJpYWJsZXMsIGlmIG9wdGlvbiBkb2VzXG4gICAqIG5vdCBoYXZlIGEgdmFsdWUgZnJvbSBjbGkgb3IgY2xpZW50IGNvZGUuXG4gICAqXG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cbiAgX3BhcnNlT3B0aW9uc0VudigpIHtcbiAgICB0aGlzLm9wdGlvbnMuZm9yRWFjaCgob3B0aW9uKSA9PiB7XG4gICAgICBpZiAob3B0aW9uLmVudlZhciAmJiBvcHRpb24uZW52VmFyIGluIHByb2Nlc3MuZW52KSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbktleSA9IG9wdGlvbi5hdHRyaWJ1dGVOYW1lKCk7XG4gICAgICAgIC8vIFByaW9yaXR5IGNoZWNrLiBEbyBub3Qgb3ZlcndyaXRlIGNsaSBvciBvcHRpb25zIGZyb20gdW5rbm93biBzb3VyY2UgKGNsaWVudC1jb2RlKS5cbiAgICAgICAgaWYgKHRoaXMuZ2V0T3B0aW9uVmFsdWUob3B0aW9uS2V5KSA9PT0gdW5kZWZpbmVkIHx8IFsnZGVmYXVsdCcsICdjb25maWcnLCAnZW52J10uaW5jbHVkZXModGhpcy5nZXRPcHRpb25WYWx1ZVNvdXJjZShvcHRpb25LZXkpKSkge1xuICAgICAgICAgIGlmIChvcHRpb24ucmVxdWlyZWQgfHwgb3B0aW9uLm9wdGlvbmFsKSB7IC8vIG9wdGlvbiBjYW4gdGFrZSBhIHZhbHVlXG4gICAgICAgICAgICAvLyBrZWVwIHZlcnkgc2ltcGxlLCBvcHRpb25hbCBhbHdheXMgdGFrZXMgdmFsdWVcbiAgICAgICAgICAgIHRoaXMuZW1pdChgb3B0aW9uRW52OiR7b3B0aW9uLm5hbWUoKX1gLCBwcm9jZXNzLmVudltvcHRpb24uZW52VmFyXSk7XG4gICAgICAgICAgfSBlbHNlIHsgLy8gYm9vbGVhblxuICAgICAgICAgICAgLy8ga2VlcCB2ZXJ5IHNpbXBsZSwgb25seSBjYXJlIHRoYXQgZW52VmFyIGRlZmluZWQgYW5kIG5vdCB0aGUgdmFsdWVcbiAgICAgICAgICAgIHRoaXMuZW1pdChgb3B0aW9uRW52OiR7b3B0aW9uLm5hbWUoKX1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBcmd1bWVudCBgbmFtZWAgaXMgbWlzc2luZy5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWVcbiAgICogQGFwaSBwcml2YXRlXG4gICAqL1xuXG4gIG1pc3NpbmdBcmd1bWVudChuYW1lKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGBlcnJvcjogbWlzc2luZyByZXF1aXJlZCBhcmd1bWVudCAnJHtuYW1lfSdgO1xuICAgIHRoaXMuZXJyb3IobWVzc2FnZSwgeyBjb2RlOiAnY29tbWFuZGVyLm1pc3NpbmdBcmd1bWVudCcgfSk7XG4gIH1cblxuICAvKipcbiAgICogYE9wdGlvbmAgaXMgbWlzc2luZyBhbiBhcmd1bWVudC5cbiAgICpcbiAgICogQHBhcmFtIHtPcHRpb259IG9wdGlvblxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgb3B0aW9uTWlzc2luZ0FyZ3VtZW50KG9wdGlvbikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBgZXJyb3I6IG9wdGlvbiAnJHtvcHRpb24uZmxhZ3N9JyBhcmd1bWVudCBtaXNzaW5nYDtcbiAgICB0aGlzLmVycm9yKG1lc3NhZ2UsIHsgY29kZTogJ2NvbW1hbmRlci5vcHRpb25NaXNzaW5nQXJndW1lbnQnIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIGBPcHRpb25gIGRvZXMgbm90IGhhdmUgYSB2YWx1ZSwgYW5kIGlzIGEgbWFuZGF0b3J5IG9wdGlvbi5cbiAgICpcbiAgICogQHBhcmFtIHtPcHRpb259IG9wdGlvblxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgbWlzc2luZ01hbmRhdG9yeU9wdGlvblZhbHVlKG9wdGlvbikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBgZXJyb3I6IHJlcXVpcmVkIG9wdGlvbiAnJHtvcHRpb24uZmxhZ3N9JyBub3Qgc3BlY2lmaWVkYDtcbiAgICB0aGlzLmVycm9yKG1lc3NhZ2UsIHsgY29kZTogJ2NvbW1hbmRlci5taXNzaW5nTWFuZGF0b3J5T3B0aW9uVmFsdWUnIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIGBPcHRpb25gIGNvbmZsaWN0cyB3aXRoIGFub3RoZXIgb3B0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0ge09wdGlvbn0gb3B0aW9uXG4gICAqIEBwYXJhbSB7T3B0aW9ufSBjb25mbGljdGluZ09wdGlvblxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG4gIF9jb25mbGljdGluZ09wdGlvbihvcHRpb24sIGNvbmZsaWN0aW5nT3B0aW9uKSB7XG4gICAgLy8gVGhlIGNhbGxpbmcgY29kZSBkb2VzIG5vdCBrbm93IHdoZXRoZXIgYSBuZWdhdGVkIG9wdGlvbiBpcyB0aGUgc291cmNlIG9mIHRoZVxuICAgIC8vIHZhbHVlLCBzbyBkbyBzb21lIHdvcmsgdG8gdGFrZSBhbiBlZHVjYXRlZCBndWVzcy5cbiAgICBjb25zdCBmaW5kQmVzdE9wdGlvbkZyb21WYWx1ZSA9IChvcHRpb24pID0+IHtcbiAgICAgIGNvbnN0IG9wdGlvbktleSA9IG9wdGlvbi5hdHRyaWJ1dGVOYW1lKCk7XG4gICAgICBjb25zdCBvcHRpb25WYWx1ZSA9IHRoaXMuZ2V0T3B0aW9uVmFsdWUob3B0aW9uS2V5KTtcbiAgICAgIGNvbnN0IG5lZ2F0aXZlT3B0aW9uID0gdGhpcy5vcHRpb25zLmZpbmQodGFyZ2V0ID0+IHRhcmdldC5uZWdhdGUgJiYgb3B0aW9uS2V5ID09PSB0YXJnZXQuYXR0cmlidXRlTmFtZSgpKTtcbiAgICAgIGNvbnN0IHBvc2l0aXZlT3B0aW9uID0gdGhpcy5vcHRpb25zLmZpbmQodGFyZ2V0ID0+ICF0YXJnZXQubmVnYXRlICYmIG9wdGlvbktleSA9PT0gdGFyZ2V0LmF0dHJpYnV0ZU5hbWUoKSk7XG4gICAgICBpZiAobmVnYXRpdmVPcHRpb24gJiYgKFxuICAgICAgICAobmVnYXRpdmVPcHRpb24ucHJlc2V0QXJnID09PSB1bmRlZmluZWQgJiYgb3B0aW9uVmFsdWUgPT09IGZhbHNlKSB8fFxuICAgICAgICAobmVnYXRpdmVPcHRpb24ucHJlc2V0QXJnICE9PSB1bmRlZmluZWQgJiYgb3B0aW9uVmFsdWUgPT09IG5lZ2F0aXZlT3B0aW9uLnByZXNldEFyZylcbiAgICAgICkpIHtcbiAgICAgICAgcmV0dXJuIG5lZ2F0aXZlT3B0aW9uO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBvc2l0aXZlT3B0aW9uIHx8IG9wdGlvbjtcbiAgICB9O1xuXG4gICAgY29uc3QgZ2V0RXJyb3JNZXNzYWdlID0gKG9wdGlvbikgPT4ge1xuICAgICAgY29uc3QgYmVzdE9wdGlvbiA9IGZpbmRCZXN0T3B0aW9uRnJvbVZhbHVlKG9wdGlvbik7XG4gICAgICBjb25zdCBvcHRpb25LZXkgPSBiZXN0T3B0aW9uLmF0dHJpYnV0ZU5hbWUoKTtcbiAgICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMuZ2V0T3B0aW9uVmFsdWVTb3VyY2Uob3B0aW9uS2V5KTtcbiAgICAgIGlmIChzb3VyY2UgPT09ICdlbnYnKSB7XG4gICAgICAgIHJldHVybiBgZW52aXJvbm1lbnQgdmFyaWFibGUgJyR7YmVzdE9wdGlvbi5lbnZWYXJ9J2A7XG4gICAgICB9XG4gICAgICByZXR1cm4gYG9wdGlvbiAnJHtiZXN0T3B0aW9uLmZsYWdzfSdgO1xuICAgIH07XG5cbiAgICBjb25zdCBtZXNzYWdlID0gYGVycm9yOiAke2dldEVycm9yTWVzc2FnZShvcHRpb24pfSBjYW5ub3QgYmUgdXNlZCB3aXRoICR7Z2V0RXJyb3JNZXNzYWdlKGNvbmZsaWN0aW5nT3B0aW9uKX1gO1xuICAgIHRoaXMuZXJyb3IobWVzc2FnZSwgeyBjb2RlOiAnY29tbWFuZGVyLmNvbmZsaWN0aW5nT3B0aW9uJyB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVbmtub3duIG9wdGlvbiBgZmxhZ2AuXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmbGFnXG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cblxuICB1bmtub3duT3B0aW9uKGZsYWcpIHtcbiAgICBpZiAodGhpcy5fYWxsb3dVbmtub3duT3B0aW9uKSByZXR1cm47XG4gICAgbGV0IHN1Z2dlc3Rpb24gPSAnJztcblxuICAgIGlmIChmbGFnLnN0YXJ0c1dpdGgoJy0tJykgJiYgdGhpcy5fc2hvd1N1Z2dlc3Rpb25BZnRlckVycm9yKSB7XG4gICAgICAvLyBMb29waW5nIHRvIHBpY2sgdXAgdGhlIGdsb2JhbCBvcHRpb25zIHRvb1xuICAgICAgbGV0IGNhbmRpZGF0ZUZsYWdzID0gW107XG4gICAgICBsZXQgY29tbWFuZCA9IHRoaXM7XG4gICAgICBkbyB7XG4gICAgICAgIGNvbnN0IG1vcmVGbGFncyA9IGNvbW1hbmQuY3JlYXRlSGVscCgpLnZpc2libGVPcHRpb25zKGNvbW1hbmQpXG4gICAgICAgICAgLmZpbHRlcihvcHRpb24gPT4gb3B0aW9uLmxvbmcpXG4gICAgICAgICAgLm1hcChvcHRpb24gPT4gb3B0aW9uLmxvbmcpO1xuICAgICAgICBjYW5kaWRhdGVGbGFncyA9IGNhbmRpZGF0ZUZsYWdzLmNvbmNhdChtb3JlRmxhZ3MpO1xuICAgICAgICBjb21tYW5kID0gY29tbWFuZC5wYXJlbnQ7XG4gICAgICB9IHdoaWxlIChjb21tYW5kICYmICFjb21tYW5kLl9lbmFibGVQb3NpdGlvbmFsT3B0aW9ucyk7XG4gICAgICBzdWdnZXN0aW9uID0gc3VnZ2VzdFNpbWlsYXIoZmxhZywgY2FuZGlkYXRlRmxhZ3MpO1xuICAgIH1cblxuICAgIGNvbnN0IG1lc3NhZ2UgPSBgZXJyb3I6IHVua25vd24gb3B0aW9uICcke2ZsYWd9JyR7c3VnZ2VzdGlvbn1gO1xuICAgIHRoaXMuZXJyb3IobWVzc2FnZSwgeyBjb2RlOiAnY29tbWFuZGVyLnVua25vd25PcHRpb24nIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4Y2VzcyBhcmd1bWVudHMsIG1vcmUgdGhhbiBleHBlY3RlZC5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcmVjZWl2ZWRBcmdzXG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cblxuICBfZXhjZXNzQXJndW1lbnRzKHJlY2VpdmVkQXJncykge1xuICAgIGlmICh0aGlzLl9hbGxvd0V4Y2Vzc0FyZ3VtZW50cykgcmV0dXJuO1xuXG4gICAgY29uc3QgZXhwZWN0ZWQgPSB0aGlzLl9hcmdzLmxlbmd0aDtcbiAgICBjb25zdCBzID0gKGV4cGVjdGVkID09PSAxKSA/ICcnIDogJ3MnO1xuICAgIGNvbnN0IGZvclN1YmNvbW1hbmQgPSB0aGlzLnBhcmVudCA/IGAgZm9yICcke3RoaXMubmFtZSgpfSdgIDogJyc7XG4gICAgY29uc3QgbWVzc2FnZSA9IGBlcnJvcjogdG9vIG1hbnkgYXJndW1lbnRzJHtmb3JTdWJjb21tYW5kfS4gRXhwZWN0ZWQgJHtleHBlY3RlZH0gYXJndW1lbnQke3N9IGJ1dCBnb3QgJHtyZWNlaXZlZEFyZ3MubGVuZ3RofS5gO1xuICAgIHRoaXMuZXJyb3IobWVzc2FnZSwgeyBjb2RlOiAnY29tbWFuZGVyLmV4Y2Vzc0FyZ3VtZW50cycgfSk7XG4gIH1cblxuICAvKipcbiAgICogVW5rbm93biBjb21tYW5kLlxuICAgKlxuICAgKiBAYXBpIHByaXZhdGVcbiAgICovXG5cbiAgdW5rbm93bkNvbW1hbmQoKSB7XG4gICAgY29uc3QgdW5rbm93bk5hbWUgPSB0aGlzLmFyZ3NbMF07XG4gICAgbGV0IHN1Z2dlc3Rpb24gPSAnJztcblxuICAgIGlmICh0aGlzLl9zaG93U3VnZ2VzdGlvbkFmdGVyRXJyb3IpIHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gW107XG4gICAgICB0aGlzLmNyZWF0ZUhlbHAoKS52aXNpYmxlQ29tbWFuZHModGhpcykuZm9yRWFjaCgoY29tbWFuZCkgPT4ge1xuICAgICAgICBjYW5kaWRhdGVOYW1lcy5wdXNoKGNvbW1hbmQubmFtZSgpKTtcbiAgICAgICAgLy8ganVzdCB2aXNpYmxlIGFsaWFzXG4gICAgICAgIGlmIChjb21tYW5kLmFsaWFzKCkpIGNhbmRpZGF0ZU5hbWVzLnB1c2goY29tbWFuZC5hbGlhcygpKTtcbiAgICAgIH0pO1xuICAgICAgc3VnZ2VzdGlvbiA9IHN1Z2dlc3RTaW1pbGFyKHVua25vd25OYW1lLCBjYW5kaWRhdGVOYW1lcyk7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZSA9IGBlcnJvcjogdW5rbm93biBjb21tYW5kICcke3Vua25vd25OYW1lfScke3N1Z2dlc3Rpb259YDtcbiAgICB0aGlzLmVycm9yKG1lc3NhZ2UsIHsgY29kZTogJ2NvbW1hbmRlci51bmtub3duQ29tbWFuZCcgfSk7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHRoZSBwcm9ncmFtIHZlcnNpb24gdG8gYHN0cmAuXG4gICAqXG4gICAqIFRoaXMgbWV0aG9kIGF1dG8tcmVnaXN0ZXJzIHRoZSBcIi1WLCAtLXZlcnNpb25cIiBmbGFnXG4gICAqIHdoaWNoIHdpbGwgcHJpbnQgdGhlIHZlcnNpb24gbnVtYmVyIHdoZW4gcGFzc2VkLlxuICAgKlxuICAgKiBZb3UgY2FuIG9wdGlvbmFsbHkgc3VwcGx5IHRoZSAgZmxhZ3MgYW5kIGRlc2NyaXB0aW9uIHRvIG92ZXJyaWRlIHRoZSBkZWZhdWx0cy5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IHN0clxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2ZsYWdzXVxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2Rlc2NyaXB0aW9uXVxuICAgKiBAcmV0dXJuIHt0aGlzIHwgc3RyaW5nfSBgdGhpc2AgY29tbWFuZCBmb3IgY2hhaW5pbmcsIG9yIHZlcnNpb24gc3RyaW5nIGlmIG5vIGFyZ3VtZW50c1xuICAgKi9cblxuICB2ZXJzaW9uKHN0ciwgZmxhZ3MsIGRlc2NyaXB0aW9uKSB7XG4gICAgaWYgKHN0ciA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fdmVyc2lvbjtcbiAgICB0aGlzLl92ZXJzaW9uID0gc3RyO1xuICAgIGZsYWdzID0gZmxhZ3MgfHwgJy1WLCAtLXZlcnNpb24nO1xuICAgIGRlc2NyaXB0aW9uID0gZGVzY3JpcHRpb24gfHwgJ291dHB1dCB0aGUgdmVyc2lvbiBudW1iZXInO1xuICAgIGNvbnN0IHZlcnNpb25PcHRpb24gPSB0aGlzLmNyZWF0ZU9wdGlvbihmbGFncywgZGVzY3JpcHRpb24pO1xuICAgIHRoaXMuX3ZlcnNpb25PcHRpb25OYW1lID0gdmVyc2lvbk9wdGlvbi5hdHRyaWJ1dGVOYW1lKCk7XG4gICAgdGhpcy5vcHRpb25zLnB1c2godmVyc2lvbk9wdGlvbik7XG4gICAgdGhpcy5vbignb3B0aW9uOicgKyB2ZXJzaW9uT3B0aW9uLm5hbWUoKSwgKCkgPT4ge1xuICAgICAgdGhpcy5fb3V0cHV0Q29uZmlndXJhdGlvbi53cml0ZU91dChgJHtzdHJ9XFxuYCk7XG4gICAgICB0aGlzLl9leGl0KDAsICdjb21tYW5kZXIudmVyc2lvbicsIHN0cik7XG4gICAgfSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHRoZSBkZXNjcmlwdGlvbiB0byBgc3RyYC5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtzdHJdXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbYXJnc0Rlc2NyaXB0aW9uXVxuICAgKiBAcmV0dXJuIHtzdHJpbmd8Q29tbWFuZH1cbiAgICovXG4gIGRlc2NyaXB0aW9uKHN0ciwgYXJnc0Rlc2NyaXB0aW9uKSB7XG4gICAgaWYgKHN0ciA9PT0gdW5kZWZpbmVkICYmIGFyZ3NEZXNjcmlwdGlvbiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fZGVzY3JpcHRpb247XG4gICAgdGhpcy5fZGVzY3JpcHRpb24gPSBzdHI7XG4gICAgaWYgKGFyZ3NEZXNjcmlwdGlvbikge1xuICAgICAgdGhpcy5fYXJnc0Rlc2NyaXB0aW9uID0gYXJnc0Rlc2NyaXB0aW9uO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgYW4gYWxpYXMgZm9yIHRoZSBjb21tYW5kLlxuICAgKlxuICAgKiBZb3UgbWF5IGNhbGwgbW9yZSB0aGFuIG9uY2UgdG8gYWRkIG11bHRpcGxlIGFsaWFzZXMuIE9ubHkgdGhlIGZpcnN0IGFsaWFzIGlzIHNob3duIGluIHRoZSBhdXRvLWdlbmVyYXRlZCBoZWxwLlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FsaWFzXVxuICAgKiBAcmV0dXJuIHtzdHJpbmd8Q29tbWFuZH1cbiAgICovXG5cbiAgYWxpYXMoYWxpYXMpIHtcbiAgICBpZiAoYWxpYXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2FsaWFzZXNbMF07IC8vIGp1c3QgcmV0dXJuIGZpcnN0LCBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcblxuICAgIC8qKiBAdHlwZSB7Q29tbWFuZH0gKi9cbiAgICBsZXQgY29tbWFuZCA9IHRoaXM7XG4gICAgaWYgKHRoaXMuY29tbWFuZHMubGVuZ3RoICE9PSAwICYmIHRoaXMuY29tbWFuZHNbdGhpcy5jb21tYW5kcy5sZW5ndGggLSAxXS5fZXhlY3V0YWJsZUhhbmRsZXIpIHtcbiAgICAgIC8vIGFzc3VtZSBhZGRpbmcgYWxpYXMgZm9yIGxhc3QgYWRkZWQgZXhlY3V0YWJsZSBzdWJjb21tYW5kLCByYXRoZXIgdGhhbiB0aGlzXG4gICAgICBjb21tYW5kID0gdGhpcy5jb21tYW5kc1t0aGlzLmNvbW1hbmRzLmxlbmd0aCAtIDFdO1xuICAgIH1cblxuICAgIGlmIChhbGlhcyA9PT0gY29tbWFuZC5fbmFtZSkgdGhyb3cgbmV3IEVycm9yKCdDb21tYW5kIGFsaWFzIGNhblxcJ3QgYmUgdGhlIHNhbWUgYXMgaXRzIG5hbWUnKTtcblxuICAgIGNvbW1hbmQuX2FsaWFzZXMucHVzaChhbGlhcyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGFsaWFzZXMgZm9yIHRoZSBjb21tYW5kLlxuICAgKlxuICAgKiBPbmx5IHRoZSBmaXJzdCBhbGlhcyBpcyBzaG93biBpbiB0aGUgYXV0by1nZW5lcmF0ZWQgaGVscC5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FsaWFzZXNdXG4gICAqIEByZXR1cm4ge3N0cmluZ1tdfENvbW1hbmR9XG4gICAqL1xuXG4gIGFsaWFzZXMoYWxpYXNlcykge1xuICAgIC8vIEdldHRlciBmb3IgdGhlIGFycmF5IG9mIGFsaWFzZXMgaXMgdGhlIG1haW4gcmVhc29uIGZvciBoYXZpbmcgYWxpYXNlcygpIGluIGFkZGl0aW9uIHRvIGFsaWFzKCkuXG4gICAgaWYgKGFsaWFzZXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2FsaWFzZXM7XG5cbiAgICBhbGlhc2VzLmZvckVhY2goKGFsaWFzKSA9PiB0aGlzLmFsaWFzKGFsaWFzKSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IC8gZ2V0IHRoZSBjb21tYW5kIHVzYWdlIGBzdHJgLlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3N0cl1cbiAgICogQHJldHVybiB7U3RyaW5nfENvbW1hbmR9XG4gICAqL1xuXG4gIHVzYWdlKHN0cikge1xuICAgIGlmIChzdHIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKHRoaXMuX3VzYWdlKSByZXR1cm4gdGhpcy5fdXNhZ2U7XG5cbiAgICAgIGNvbnN0IGFyZ3MgPSB0aGlzLl9hcmdzLm1hcCgoYXJnKSA9PiB7XG4gICAgICAgIHJldHVybiBodW1hblJlYWRhYmxlQXJnTmFtZShhcmcpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gW10uY29uY2F0KFxuICAgICAgICAodGhpcy5vcHRpb25zLmxlbmd0aCB8fCB0aGlzLl9oYXNIZWxwT3B0aW9uID8gJ1tvcHRpb25zXScgOiBbXSksXG4gICAgICAgICh0aGlzLmNvbW1hbmRzLmxlbmd0aCA/ICdbY29tbWFuZF0nIDogW10pLFxuICAgICAgICAodGhpcy5fYXJncy5sZW5ndGggPyBhcmdzIDogW10pXG4gICAgICApLmpvaW4oJyAnKTtcbiAgICB9XG5cbiAgICB0aGlzLl91c2FnZSA9IHN0cjtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgb3Igc2V0IHRoZSBuYW1lIG9mIHRoZSBjb21tYW5kLlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW3N0cl1cbiAgICogQHJldHVybiB7c3RyaW5nfENvbW1hbmR9XG4gICAqL1xuXG4gIG5hbWUoc3RyKSB7XG4gICAgaWYgKHN0ciA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fbmFtZTtcbiAgICB0aGlzLl9uYW1lID0gc3RyO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCB0aGUgbmFtZSBvZiB0aGUgY29tbWFuZCBmcm9tIHNjcmlwdCBmaWxlbmFtZSwgc3VjaCBhcyBwcm9jZXNzLmFyZ3ZbMV0sXG4gICAqIG9yIHJlcXVpcmUubWFpbi5maWxlbmFtZSwgb3IgX19maWxlbmFtZS5cbiAgICpcbiAgICogKFVzZWQgaW50ZXJuYWxseSBhbmQgcHVibGljIGFsdGhvdWdoIG5vdCBkb2N1bWVudGVkIGluIFJFQURNRS4pXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIHByb2dyYW0ubmFtZUZyb21GaWxlbmFtZShyZXF1aXJlLm1haW4uZmlsZW5hbWUpO1xuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZW5hbWVcbiAgICogQHJldHVybiB7Q29tbWFuZH1cbiAgICovXG5cbiAgbmFtZUZyb21GaWxlbmFtZShmaWxlbmFtZSkge1xuICAgIHRoaXMuX25hbWUgPSBwYXRoLmJhc2VuYW1lKGZpbGVuYW1lLCBwYXRoLmV4dG5hbWUoZmlsZW5hbWUpKTtcblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBvciBzZXQgdGhlIGRpcmVjdG9yeSBmb3Igc2VhcmNoaW5nIGZvciBleGVjdXRhYmxlIHN1YmNvbW1hbmRzIG9mIHRoaXMgY29tbWFuZC5cbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICogcHJvZ3JhbS5leGVjdXRhYmxlRGlyKF9fZGlybmFtZSk7XG4gICAqIC8vIG9yXG4gICAqIHByb2dyYW0uZXhlY3V0YWJsZURpcignc3ViY29tbWFuZHMnKTtcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtwYXRoXVxuICAgKiBAcmV0dXJuIHtzdHJpbmd8Q29tbWFuZH1cbiAgICovXG5cbiAgZXhlY3V0YWJsZURpcihwYXRoKSB7XG4gICAgaWYgKHBhdGggPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuX2V4ZWN1dGFibGVEaXI7XG4gICAgdGhpcy5fZXhlY3V0YWJsZURpciA9IHBhdGg7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHByb2dyYW0gaGVscCBkb2N1bWVudGF0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0ge3sgZXJyb3I6IGJvb2xlYW4gfX0gW2NvbnRleHRPcHRpb25zXSAtIHBhc3Mge2Vycm9yOnRydWV9IHRvIHdyYXAgZm9yIHN0ZGVyciBpbnN0ZWFkIG9mIHN0ZG91dFxuICAgKiBAcmV0dXJuIHtzdHJpbmd9XG4gICAqL1xuXG4gIGhlbHBJbmZvcm1hdGlvbihjb250ZXh0T3B0aW9ucykge1xuICAgIGNvbnN0IGhlbHBlciA9IHRoaXMuY3JlYXRlSGVscCgpO1xuICAgIGlmIChoZWxwZXIuaGVscFdpZHRoID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGhlbHBlci5oZWxwV2lkdGggPSAoY29udGV4dE9wdGlvbnMgJiYgY29udGV4dE9wdGlvbnMuZXJyb3IpID8gdGhpcy5fb3V0cHV0Q29uZmlndXJhdGlvbi5nZXRFcnJIZWxwV2lkdGgoKSA6IHRoaXMuX291dHB1dENvbmZpZ3VyYXRpb24uZ2V0T3V0SGVscFdpZHRoKCk7XG4gICAgfVxuICAgIHJldHVybiBoZWxwZXIuZm9ybWF0SGVscCh0aGlzLCBoZWxwZXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBhcGkgcHJpdmF0ZVxuICAgKi9cblxuICBfZ2V0SGVscENvbnRleHQoY29udGV4dE9wdGlvbnMpIHtcbiAgICBjb250ZXh0T3B0aW9ucyA9IGNvbnRleHRPcHRpb25zIHx8IHt9O1xuICAgIGNvbnN0IGNvbnRleHQgPSB7IGVycm9yOiAhIWNvbnRleHRPcHRpb25zLmVycm9yIH07XG4gICAgbGV0IHdyaXRlO1xuICAgIGlmIChjb250ZXh0LmVycm9yKSB7XG4gICAgICB3cml0ZSA9IChhcmcpID0+IHRoaXMuX291dHB1dENvbmZpZ3VyYXRpb24ud3JpdGVFcnIoYXJnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgd3JpdGUgPSAoYXJnKSA9PiB0aGlzLl9vdXRwdXRDb25maWd1cmF0aW9uLndyaXRlT3V0KGFyZyk7XG4gICAgfVxuICAgIGNvbnRleHQud3JpdGUgPSBjb250ZXh0T3B0aW9ucy53cml0ZSB8fCB3cml0ZTtcbiAgICBjb250ZXh0LmNvbW1hbmQgPSB0aGlzO1xuICAgIHJldHVybiBjb250ZXh0O1xuICB9XG5cbiAgLyoqXG4gICAqIE91dHB1dCBoZWxwIGluZm9ybWF0aW9uIGZvciB0aGlzIGNvbW1hbmQuXG4gICAqXG4gICAqIE91dHB1dHMgYnVpbHQtaW4gaGVscCwgYW5kIGN1c3RvbSB0ZXh0IGFkZGVkIHVzaW5nIGAuYWRkSGVscFRleHQoKWAuXG4gICAqXG4gICAqIEBwYXJhbSB7eyBlcnJvcjogYm9vbGVhbiB9IHwgRnVuY3Rpb259IFtjb250ZXh0T3B0aW9uc10gLSBwYXNzIHtlcnJvcjp0cnVlfSB0byB3cml0ZSB0byBzdGRlcnIgaW5zdGVhZCBvZiBzdGRvdXRcbiAgICovXG5cbiAgb3V0cHV0SGVscChjb250ZXh0T3B0aW9ucykge1xuICAgIGxldCBkZXByZWNhdGVkQ2FsbGJhY2s7XG4gICAgaWYgKHR5cGVvZiBjb250ZXh0T3B0aW9ucyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgZGVwcmVjYXRlZENhbGxiYWNrID0gY29udGV4dE9wdGlvbnM7XG4gICAgICBjb250ZXh0T3B0aW9ucyA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuX2dldEhlbHBDb250ZXh0KGNvbnRleHRPcHRpb25zKTtcblxuICAgIGdldENvbW1hbmRBbmRQYXJlbnRzKHRoaXMpLnJldmVyc2UoKS5mb3JFYWNoKGNvbW1hbmQgPT4gY29tbWFuZC5lbWl0KCdiZWZvcmVBbGxIZWxwJywgY29udGV4dCkpO1xuICAgIHRoaXMuZW1pdCgnYmVmb3JlSGVscCcsIGNvbnRleHQpO1xuXG4gICAgbGV0IGhlbHBJbmZvcm1hdGlvbiA9IHRoaXMuaGVscEluZm9ybWF0aW9uKGNvbnRleHQpO1xuICAgIGlmIChkZXByZWNhdGVkQ2FsbGJhY2spIHtcbiAgICAgIGhlbHBJbmZvcm1hdGlvbiA9IGRlcHJlY2F0ZWRDYWxsYmFjayhoZWxwSW5mb3JtYXRpb24pO1xuICAgICAgaWYgKHR5cGVvZiBoZWxwSW5mb3JtYXRpb24gIT09ICdzdHJpbmcnICYmICFCdWZmZXIuaXNCdWZmZXIoaGVscEluZm9ybWF0aW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ291dHB1dEhlbHAgY2FsbGJhY2sgbXVzdCByZXR1cm4gYSBzdHJpbmcgb3IgYSBCdWZmZXInKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29udGV4dC53cml0ZShoZWxwSW5mb3JtYXRpb24pO1xuXG4gICAgdGhpcy5lbWl0KHRoaXMuX2hlbHBMb25nRmxhZyk7IC8vIGRlcHJlY2F0ZWRcbiAgICB0aGlzLmVtaXQoJ2FmdGVySGVscCcsIGNvbnRleHQpO1xuICAgIGdldENvbW1hbmRBbmRQYXJlbnRzKHRoaXMpLmZvckVhY2goY29tbWFuZCA9PiBjb21tYW5kLmVtaXQoJ2FmdGVyQWxsSGVscCcsIGNvbnRleHQpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBZb3UgY2FuIHBhc3MgaW4gZmxhZ3MgYW5kIGEgZGVzY3JpcHRpb24gdG8gb3ZlcnJpZGUgdGhlIGhlbHBcbiAgICogZmxhZ3MgYW5kIGhlbHAgZGVzY3JpcHRpb24gZm9yIHlvdXIgY29tbWFuZC4gUGFzcyBpbiBmYWxzZSB0b1xuICAgKiBkaXNhYmxlIHRoZSBidWlsdC1pbiBoZWxwIG9wdGlvbi5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmcgfCBib29sZWFufSBbZmxhZ3NdXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cblxuICBoZWxwT3B0aW9uKGZsYWdzLCBkZXNjcmlwdGlvbikge1xuICAgIGlmICh0eXBlb2YgZmxhZ3MgPT09ICdib29sZWFuJykge1xuICAgICAgdGhpcy5faGFzSGVscE9wdGlvbiA9IGZsYWdzO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIHRoaXMuX2hlbHBGbGFncyA9IGZsYWdzIHx8IHRoaXMuX2hlbHBGbGFncztcbiAgICB0aGlzLl9oZWxwRGVzY3JpcHRpb24gPSBkZXNjcmlwdGlvbiB8fCB0aGlzLl9oZWxwRGVzY3JpcHRpb247XG5cbiAgICBjb25zdCBoZWxwRmxhZ3MgPSBzcGxpdE9wdGlvbkZsYWdzKHRoaXMuX2hlbHBGbGFncyk7XG4gICAgdGhpcy5faGVscFNob3J0RmxhZyA9IGhlbHBGbGFncy5zaG9ydEZsYWc7XG4gICAgdGhpcy5faGVscExvbmdGbGFnID0gaGVscEZsYWdzLmxvbmdGbGFnO1xuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogT3V0cHV0IGhlbHAgaW5mb3JtYXRpb24gYW5kIGV4aXQuXG4gICAqXG4gICAqIE91dHB1dHMgYnVpbHQtaW4gaGVscCwgYW5kIGN1c3RvbSB0ZXh0IGFkZGVkIHVzaW5nIGAuYWRkSGVscFRleHQoKWAuXG4gICAqXG4gICAqIEBwYXJhbSB7eyBlcnJvcjogYm9vbGVhbiB9fSBbY29udGV4dE9wdGlvbnNdIC0gcGFzcyB7ZXJyb3I6dHJ1ZX0gdG8gd3JpdGUgdG8gc3RkZXJyIGluc3RlYWQgb2Ygc3Rkb3V0XG4gICAqL1xuXG4gIGhlbHAoY29udGV4dE9wdGlvbnMpIHtcbiAgICB0aGlzLm91dHB1dEhlbHAoY29udGV4dE9wdGlvbnMpO1xuICAgIGxldCBleGl0Q29kZSA9IHByb2Nlc3MuZXhpdENvZGUgfHwgMDtcbiAgICBpZiAoZXhpdENvZGUgPT09IDAgJiYgY29udGV4dE9wdGlvbnMgJiYgdHlwZW9mIGNvbnRleHRPcHRpb25zICE9PSAnZnVuY3Rpb24nICYmIGNvbnRleHRPcHRpb25zLmVycm9yKSB7XG4gICAgICBleGl0Q29kZSA9IDE7XG4gICAgfVxuICAgIC8vIG1lc3NhZ2U6IGRvIG5vdCBoYXZlIGFsbCBkaXNwbGF5ZWQgdGV4dCBhdmFpbGFibGUgc28gb25seSBwYXNzaW5nIHBsYWNlaG9sZGVyLlxuICAgIHRoaXMuX2V4aXQoZXhpdENvZGUsICdjb21tYW5kZXIuaGVscCcsICcob3V0cHV0SGVscCknKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYWRkaXRpb25hbCB0ZXh0IHRvIGJlIGRpc3BsYXllZCB3aXRoIHRoZSBidWlsdC1pbiBoZWxwLlxuICAgKlxuICAgKiBQb3NpdGlvbiBpcyAnYmVmb3JlJyBvciAnYWZ0ZXInIHRvIGFmZmVjdCBqdXN0IHRoaXMgY29tbWFuZCxcbiAgICogYW5kICdiZWZvcmVBbGwnIG9yICdhZnRlckFsbCcgdG8gYWZmZWN0IHRoaXMgY29tbWFuZCBhbmQgYWxsIGl0cyBzdWJjb21tYW5kcy5cbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IHBvc2l0aW9uIC0gYmVmb3JlIG9yIGFmdGVyIGJ1aWx0LWluIGhlbHBcbiAgICogQHBhcmFtIHtzdHJpbmcgfCBGdW5jdGlvbn0gdGV4dCAtIHN0cmluZyB0byBhZGQsIG9yIGEgZnVuY3Rpb24gcmV0dXJuaW5nIGEgc3RyaW5nXG4gICAqIEByZXR1cm4ge0NvbW1hbmR9IGB0aGlzYCBjb21tYW5kIGZvciBjaGFpbmluZ1xuICAgKi9cbiAgYWRkSGVscFRleHQocG9zaXRpb24sIHRleHQpIHtcbiAgICBjb25zdCBhbGxvd2VkVmFsdWVzID0gWydiZWZvcmVBbGwnLCAnYmVmb3JlJywgJ2FmdGVyJywgJ2FmdGVyQWxsJ107XG4gICAgaWYgKCFhbGxvd2VkVmFsdWVzLmluY2x1ZGVzKHBvc2l0aW9uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHZhbHVlIGZvciBwb3NpdGlvbiB0byBhZGRIZWxwVGV4dC5cbkV4cGVjdGluZyBvbmUgb2YgJyR7YWxsb3dlZFZhbHVlcy5qb2luKFwiJywgJ1wiKX0nYCk7XG4gICAgfVxuICAgIGNvbnN0IGhlbHBFdmVudCA9IGAke3Bvc2l0aW9ufUhlbHBgO1xuICAgIHRoaXMub24oaGVscEV2ZW50LCAoY29udGV4dCkgPT4ge1xuICAgICAgbGV0IGhlbHBTdHI7XG4gICAgICBpZiAodHlwZW9mIHRleHQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgaGVscFN0ciA9IHRleHQoeyBlcnJvcjogY29udGV4dC5lcnJvciwgY29tbWFuZDogY29udGV4dC5jb21tYW5kIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaGVscFN0ciA9IHRleHQ7XG4gICAgICB9XG4gICAgICAvLyBJZ25vcmUgZmFsc3kgdmFsdWUgd2hlbiBub3RoaW5nIHRvIG91dHB1dC5cbiAgICAgIGlmIChoZWxwU3RyKSB7XG4gICAgICAgIGNvbnRleHQud3JpdGUoYCR7aGVscFN0cn1cXG5gKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxufVxuXG4vKipcbiAqIE91dHB1dCBoZWxwIGluZm9ybWF0aW9uIGlmIGhlbHAgZmxhZ3Mgc3BlY2lmaWVkXG4gKlxuICogQHBhcmFtIHtDb21tYW5kfSBjbWQgLSBjb21tYW5kIHRvIG91dHB1dCBoZWxwIGZvclxuICogQHBhcmFtIHtBcnJheX0gYXJncyAtIGFycmF5IG9mIG9wdGlvbnMgdG8gc2VhcmNoIGZvciBoZWxwIGZsYWdzXG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBvdXRwdXRIZWxwSWZSZXF1ZXN0ZWQoY21kLCBhcmdzKSB7XG4gIGNvbnN0IGhlbHBPcHRpb24gPSBjbWQuX2hhc0hlbHBPcHRpb24gJiYgYXJncy5maW5kKGFyZyA9PiBhcmcgPT09IGNtZC5faGVscExvbmdGbGFnIHx8IGFyZyA9PT0gY21kLl9oZWxwU2hvcnRGbGFnKTtcbiAgaWYgKGhlbHBPcHRpb24pIHtcbiAgICBjbWQub3V0cHV0SGVscCgpO1xuICAgIC8vIChEbyBub3QgaGF2ZSBhbGwgZGlzcGxheWVkIHRleHQgYXZhaWxhYmxlIHNvIG9ubHkgcGFzc2luZyBwbGFjZWhvbGRlci4pXG4gICAgY21kLl9leGl0KDAsICdjb21tYW5kZXIuaGVscERpc3BsYXllZCcsICcob3V0cHV0SGVscCknKTtcbiAgfVxufVxuXG4vKipcbiAqIFNjYW4gYXJndW1lbnRzIGFuZCBpbmNyZW1lbnQgcG9ydCBudW1iZXIgZm9yIGluc3BlY3QgY2FsbHMgKHRvIGF2b2lkIGNvbmZsaWN0cyB3aGVuIHNwYXduaW5nIG5ldyBjb21tYW5kKS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzIC0gYXJyYXkgb2YgYXJndW1lbnRzIGZyb20gbm9kZS5leGVjQXJndlxuICogQHJldHVybnMge3N0cmluZ1tdfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gaW5jcmVtZW50Tm9kZUluc3BlY3RvclBvcnQoYXJncykge1xuICAvLyBUZXN0aW5nIGZvciB0aGVzZSBvcHRpb25zOlxuICAvLyAgLS1pbnNwZWN0Wz1baG9zdDpdcG9ydF1cbiAgLy8gIC0taW5zcGVjdC1icmtbPVtob3N0Ol1wb3J0XVxuICAvLyAgLS1pbnNwZWN0LXBvcnQ9W2hvc3Q6XXBvcnRcbiAgcmV0dXJuIGFyZ3MubWFwKChhcmcpID0+IHtcbiAgICBpZiAoIWFyZy5zdGFydHNXaXRoKCctLWluc3BlY3QnKSkge1xuICAgICAgcmV0dXJuIGFyZztcbiAgICB9XG4gICAgbGV0IGRlYnVnT3B0aW9uO1xuICAgIGxldCBkZWJ1Z0hvc3QgPSAnMTI3LjAuMC4xJztcbiAgICBsZXQgZGVidWdQb3J0ID0gJzkyMjknO1xuICAgIGxldCBtYXRjaDtcbiAgICBpZiAoKG1hdGNoID0gYXJnLm1hdGNoKC9eKC0taW5zcGVjdCgtYnJrKT8pJC8pKSAhPT0gbnVsbCkge1xuICAgICAgLy8gZS5nLiAtLWluc3BlY3RcbiAgICAgIGRlYnVnT3B0aW9uID0gbWF0Y2hbMV07XG4gICAgfSBlbHNlIGlmICgobWF0Y2ggPSBhcmcubWF0Y2goL14oLS1pbnNwZWN0KC1icmt8LXBvcnQpPyk9KFteOl0rKSQvKSkgIT09IG51bGwpIHtcbiAgICAgIGRlYnVnT3B0aW9uID0gbWF0Y2hbMV07XG4gICAgICBpZiAoL15cXGQrJC8udGVzdChtYXRjaFszXSkpIHtcbiAgICAgICAgLy8gZS5nLiAtLWluc3BlY3Q9MTIzNFxuICAgICAgICBkZWJ1Z1BvcnQgPSBtYXRjaFszXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIGUuZy4gLS1pbnNwZWN0PWxvY2FsaG9zdFxuICAgICAgICBkZWJ1Z0hvc3QgPSBtYXRjaFszXTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKChtYXRjaCA9IGFyZy5tYXRjaCgvXigtLWluc3BlY3QoLWJya3wtcG9ydCk/KT0oW146XSspOihcXGQrKSQvKSkgIT09IG51bGwpIHtcbiAgICAgIC8vIGUuZy4gLS1pbnNwZWN0PWxvY2FsaG9zdDoxMjM0XG4gICAgICBkZWJ1Z09wdGlvbiA9IG1hdGNoWzFdO1xuICAgICAgZGVidWdIb3N0ID0gbWF0Y2hbM107XG4gICAgICBkZWJ1Z1BvcnQgPSBtYXRjaFs0XTtcbiAgICB9XG5cbiAgICBpZiAoZGVidWdPcHRpb24gJiYgZGVidWdQb3J0ICE9PSAnMCcpIHtcbiAgICAgIHJldHVybiBgJHtkZWJ1Z09wdGlvbn09JHtkZWJ1Z0hvc3R9OiR7cGFyc2VJbnQoZGVidWdQb3J0KSArIDF9YDtcbiAgICB9XG4gICAgcmV0dXJuIGFyZztcbiAgfSk7XG59XG5cbi8qKlxuICogQHBhcmFtIHtDb21tYW5kfSBzdGFydENvbW1hbmRcbiAqIEByZXR1cm5zIHtDb21tYW5kW119XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBnZXRDb21tYW5kQW5kUGFyZW50cyhzdGFydENvbW1hbmQpIHtcbiAgY29uc3QgcmVzdWx0ID0gW107XG4gIGZvciAobGV0IGNvbW1hbmQgPSBzdGFydENvbW1hbmQ7IGNvbW1hbmQ7IGNvbW1hbmQgPSBjb21tYW5kLnBhcmVudCkge1xuICAgIHJlc3VsdC5wdXNoKGNvbW1hbmQpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmV4cG9ydHMuQ29tbWFuZCA9IENvbW1hbmQ7XG4iLCJjb25zdCB7IEFyZ3VtZW50IH0gPSByZXF1aXJlKCcuL2xpYi9hcmd1bWVudC5qcycpO1xuY29uc3QgeyBDb21tYW5kIH0gPSByZXF1aXJlKCcuL2xpYi9jb21tYW5kLmpzJyk7XG5jb25zdCB7IENvbW1hbmRlckVycm9yLCBJbnZhbGlkQXJndW1lbnRFcnJvciB9ID0gcmVxdWlyZSgnLi9saWIvZXJyb3IuanMnKTtcbmNvbnN0IHsgSGVscCB9ID0gcmVxdWlyZSgnLi9saWIvaGVscC5qcycpO1xuY29uc3QgeyBPcHRpb24gfSA9IHJlcXVpcmUoJy4vbGliL29wdGlvbi5qcycpO1xuXG4vLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBFeHBvc2UgdGhlIHJvb3QgY29tbWFuZC5cbiAqL1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBuZXcgQ29tbWFuZCgpO1xuZXhwb3J0cy5wcm9ncmFtID0gZXhwb3J0czsgLy8gTW9yZSBleHBsaWNpdCBhY2Nlc3MgdG8gZ2xvYmFsIGNvbW1hbmQuXG4vLyBJbXBsaWNpdCBleHBvcnQgb2YgY3JlYXRlQXJndW1lbnQsIGNyZWF0ZUNvbW1hbmQsIGFuZCBjcmVhdGVPcHRpb24uXG5cbi8qKlxuICogRXhwb3NlIGNsYXNzZXNcbiAqL1xuXG5leHBvcnRzLkFyZ3VtZW50ID0gQXJndW1lbnQ7XG5leHBvcnRzLkNvbW1hbmQgPSBDb21tYW5kO1xuZXhwb3J0cy5Db21tYW5kZXJFcnJvciA9IENvbW1hbmRlckVycm9yO1xuZXhwb3J0cy5IZWxwID0gSGVscDtcbmV4cG9ydHMuSW52YWxpZEFyZ3VtZW50RXJyb3IgPSBJbnZhbGlkQXJndW1lbnRFcnJvcjtcbmV4cG9ydHMuSW52YWxpZE9wdGlvbkFyZ3VtZW50RXJyb3IgPSBJbnZhbGlkQXJndW1lbnRFcnJvcjsgLy8gRGVwcmVjYXRlZFxuZXhwb3J0cy5PcHRpb24gPSBPcHRpb247XG4iLCJpbXBvcnQgY29tbWFuZGVyIGZyb20gJy4vaW5kZXguanMnO1xuXG4vLyB3cmFwcGVyIHRvIHByb3ZpZGUgbmFtZWQgZXhwb3J0cyBmb3IgRVNNLlxuZXhwb3J0IGNvbnN0IHtcbiAgcHJvZ3JhbSxcbiAgY3JlYXRlQ29tbWFuZCxcbiAgY3JlYXRlQXJndW1lbnQsXG4gIGNyZWF0ZU9wdGlvbixcbiAgQ29tbWFuZGVyRXJyb3IsXG4gIEludmFsaWRBcmd1bWVudEVycm9yLFxuICBDb21tYW5kLFxuICBBcmd1bWVudCxcbiAgT3B0aW9uLFxuICBIZWxwXG59ID0gY29tbWFuZGVyO1xuIiwibGV0IHR0eSA9IHJlcXVpcmUoXCJ0dHlcIilcblxubGV0IGlzQ29sb3JTdXBwb3J0ZWQgPVxuXHQhKFwiTk9fQ09MT1JcIiBpbiBwcm9jZXNzLmVudiB8fCBwcm9jZXNzLmFyZ3YuaW5jbHVkZXMoXCItLW5vLWNvbG9yXCIpKSAmJlxuXHQoXCJGT1JDRV9DT0xPUlwiIGluIHByb2Nlc3MuZW52IHx8XG5cdFx0cHJvY2Vzcy5hcmd2LmluY2x1ZGVzKFwiLS1jb2xvclwiKSB8fFxuXHRcdHByb2Nlc3MucGxhdGZvcm0gPT09IFwid2luMzJcIiB8fFxuXHRcdCh0dHkuaXNhdHR5KDEpICYmIHByb2Nlc3MuZW52LlRFUk0gIT09IFwiZHVtYlwiKSB8fFxuXHRcdFwiQ0lcIiBpbiBwcm9jZXNzLmVudilcblxubGV0IGZvcm1hdHRlciA9XG5cdChvcGVuLCBjbG9zZSwgcmVwbGFjZSA9IG9wZW4pID0+XG5cdGlucHV0ID0+IHtcblx0XHRsZXQgc3RyaW5nID0gXCJcIiArIGlucHV0XG5cdFx0bGV0IGluZGV4ID0gc3RyaW5nLmluZGV4T2YoY2xvc2UsIG9wZW4ubGVuZ3RoKVxuXHRcdHJldHVybiB+aW5kZXhcblx0XHRcdD8gb3BlbiArIHJlcGxhY2VDbG9zZShzdHJpbmcsIGNsb3NlLCByZXBsYWNlLCBpbmRleCkgKyBjbG9zZVxuXHRcdFx0OiBvcGVuICsgc3RyaW5nICsgY2xvc2Vcblx0fVxuXG5sZXQgcmVwbGFjZUNsb3NlID0gKHN0cmluZywgY2xvc2UsIHJlcGxhY2UsIGluZGV4KSA9PiB7XG5cdGxldCBzdGFydCA9IHN0cmluZy5zdWJzdHJpbmcoMCwgaW5kZXgpICsgcmVwbGFjZVxuXHRsZXQgZW5kID0gc3RyaW5nLnN1YnN0cmluZyhpbmRleCArIGNsb3NlLmxlbmd0aClcblx0bGV0IG5leHRJbmRleCA9IGVuZC5pbmRleE9mKGNsb3NlKVxuXHRyZXR1cm4gfm5leHRJbmRleCA/IHN0YXJ0ICsgcmVwbGFjZUNsb3NlKGVuZCwgY2xvc2UsIHJlcGxhY2UsIG5leHRJbmRleCkgOiBzdGFydCArIGVuZFxufVxuXG5sZXQgY3JlYXRlQ29sb3JzID0gKGVuYWJsZWQgPSBpc0NvbG9yU3VwcG9ydGVkKSA9PiAoe1xuXHRpc0NvbG9yU3VwcG9ydGVkOiBlbmFibGVkLFxuXHRyZXNldDogZW5hYmxlZCA/IHMgPT4gYFxceDFiWzBtJHtzfVxceDFiWzBtYCA6IFN0cmluZyxcblx0Ym9sZDogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzFtXCIsIFwiXFx4MWJbMjJtXCIsIFwiXFx4MWJbMjJtXFx4MWJbMW1cIikgOiBTdHJpbmcsXG5cdGRpbTogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzJtXCIsIFwiXFx4MWJbMjJtXCIsIFwiXFx4MWJbMjJtXFx4MWJbMm1cIikgOiBTdHJpbmcsXG5cdGl0YWxpYzogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzNtXCIsIFwiXFx4MWJbMjNtXCIpIDogU3RyaW5nLFxuXHR1bmRlcmxpbmU6IGVuYWJsZWQgPyBmb3JtYXR0ZXIoXCJcXHgxYls0bVwiLCBcIlxceDFiWzI0bVwiKSA6IFN0cmluZyxcblx0aW52ZXJzZTogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzdtXCIsIFwiXFx4MWJbMjdtXCIpIDogU3RyaW5nLFxuXHRoaWRkZW46IGVuYWJsZWQgPyBmb3JtYXR0ZXIoXCJcXHgxYls4bVwiLCBcIlxceDFiWzI4bVwiKSA6IFN0cmluZyxcblx0c3RyaWtldGhyb3VnaDogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzltXCIsIFwiXFx4MWJbMjltXCIpIDogU3RyaW5nLFxuXHRibGFjazogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzMwbVwiLCBcIlxceDFiWzM5bVwiKSA6IFN0cmluZyxcblx0cmVkOiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbMzFtXCIsIFwiXFx4MWJbMzltXCIpIDogU3RyaW5nLFxuXHRncmVlbjogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzMybVwiLCBcIlxceDFiWzM5bVwiKSA6IFN0cmluZyxcblx0eWVsbG93OiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbMzNtXCIsIFwiXFx4MWJbMzltXCIpIDogU3RyaW5nLFxuXHRibHVlOiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbMzRtXCIsIFwiXFx4MWJbMzltXCIpIDogU3RyaW5nLFxuXHRtYWdlbnRhOiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbMzVtXCIsIFwiXFx4MWJbMzltXCIpIDogU3RyaW5nLFxuXHRjeWFuOiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbMzZtXCIsIFwiXFx4MWJbMzltXCIpIDogU3RyaW5nLFxuXHR3aGl0ZTogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzM3bVwiLCBcIlxceDFiWzM5bVwiKSA6IFN0cmluZyxcblx0Z3JheTogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzkwbVwiLCBcIlxceDFiWzM5bVwiKSA6IFN0cmluZyxcblx0YmdCbGFjazogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzQwbVwiLCBcIlxceDFiWzQ5bVwiKSA6IFN0cmluZyxcblx0YmdSZWQ6IGVuYWJsZWQgPyBmb3JtYXR0ZXIoXCJcXHgxYls0MW1cIiwgXCJcXHgxYls0OW1cIikgOiBTdHJpbmcsXG5cdGJnR3JlZW46IGVuYWJsZWQgPyBmb3JtYXR0ZXIoXCJcXHgxYls0Mm1cIiwgXCJcXHgxYls0OW1cIikgOiBTdHJpbmcsXG5cdGJnWWVsbG93OiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbNDNtXCIsIFwiXFx4MWJbNDltXCIpIDogU3RyaW5nLFxuXHRiZ0JsdWU6IGVuYWJsZWQgPyBmb3JtYXR0ZXIoXCJcXHgxYls0NG1cIiwgXCJcXHgxYls0OW1cIikgOiBTdHJpbmcsXG5cdGJnTWFnZW50YTogZW5hYmxlZCA/IGZvcm1hdHRlcihcIlxceDFiWzQ1bVwiLCBcIlxceDFiWzQ5bVwiKSA6IFN0cmluZyxcblx0YmdDeWFuOiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbNDZtXCIsIFwiXFx4MWJbNDltXCIpIDogU3RyaW5nLFxuXHRiZ1doaXRlOiBlbmFibGVkID8gZm9ybWF0dGVyKFwiXFx4MWJbNDdtXCIsIFwiXFx4MWJbNDltXCIpIDogU3RyaW5nLFxufSlcblxubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGVDb2xvcnMoKVxubW9kdWxlLmV4cG9ydHMuY3JlYXRlQ29sb3JzID0gY3JlYXRlQ29sb3JzXG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IG9uY2UgfSBmcm9tICcuL29uY2UnO1xuXG5leHBvcnQgY29uc3QgZ2V0TW9kdWxlUm9vdERpcmVjdG9yeUZvckltcG9ydE1ldGFVcmwgPSAob3B0czoge1xuICBpbXBvcnRNZXRhVXJsOiBzdHJpbmc7XG59KSA9PiB7XG4gIC8vIHRoaXMgaXMgaGlnaGx5IGRlcGVuZGVudCBvbiB0aGUgb3V0cHV0IGRpcmVjdG9yeSBzdHJ1Y3R1cmVcbiAgLy8gYW5kIHRoZSBjb250ZXh0IGluIHdoaWNoIHRoaXMgZnVuY3Rpb24gaXMgcnVuIChidW5kbGVkIGNvZGUgdnMgdHN4IC4vc3JjL3RzZmlsZS50cylcbiAgY29uc3QgX19maWxlTmFtZSA9IGZpbGVVUkxUb1BhdGgobmV3IFVSTChvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgY29uc3QgcGFyZW50ID0gZGlybmFtZShfX2ZpbGVOYW1lKTtcbiAgY29uc3Qgc3VwZXJQYXJlbnQgPSBkaXJuYW1lKHBhcmVudCk7XG5cbiAgY29uc3QgaXNCdW5kbGVkSW5EaXN0ID0gKCkgPT4gcGFyZW50LmVuZHNXaXRoKCcvZGlzdCcpO1xuICBjb25zdCBpc0J1bmRsZWRJbkJpbiA9ICgpID0+XG4gICAgcGFyZW50LmVuZHNXaXRoKCcvYmluJykgJiYgIXN1cGVyUGFyZW50LmVuZHNXaXRoKCcvc3JjJyk7XG5cbiAgaWYgKGlzQnVuZGxlZEluRGlzdCgpIHx8IGlzQnVuZGxlZEluQmluKCkpIHtcbiAgICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcbiAgfVxuXG4gIC8vIHJ1biB2aWEgdHN4IHRvIGJ1aWxkIHRoZSBAcmVwa2Eta2l0L3RzIGl0c2VsZlxuICByZXR1cm4gZmlsZVVSTFRvUGF0aChuZXcgVVJMKGAuLi8uLi9gLCBvcHRzLmltcG9ydE1ldGFVcmwpKTtcbn07XG5cbmV4cG9ydCBjb25zdCBtb2R1bGVSb290RGlyZWN0b3J5ID0gb25jZSgoKSA9PlxuICBnZXRNb2R1bGVSb290RGlyZWN0b3J5Rm9ySW1wb3J0TWV0YVVybCh7IGltcG9ydE1ldGFVcmw6IGltcG9ydC5tZXRhLnVybCB9KVxuKTtcbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcblxuaW1wb3J0IHsgbW9kdWxlUm9vdERpcmVjdG9yeSB9IGZyb20gJy4vbW9kdWxlUm9vdERpcmVjdG9yeSc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjb25maWdGaWxlUGF0aChwYXRoUmVsYXRpdmVUb0NvbmZpZ0Rpcjogc3RyaW5nKSB7XG4gIHJldHVybiBqb2luKG1vZHVsZVJvb3REaXJlY3RvcnkoKSwgYC4vY29uZmlncy8ke3BhdGhSZWxhdGl2ZVRvQ29uZmlnRGlyfWApO1xufVxuIiwiaW1wb3J0IHsgbG9hZCB9IGZyb20gJ2pzLXlhbWwnO1xuaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuLi9sb2dnZXIvbG9nZ2VyJztcblxuLyoqXG4gKiBEZXRlcm1pbmUgbW9ub3JlcG8gcGFja2FnZXMgZ2xvYiBieSByZWFkaW5nIG9uZSBvZiB0aGUgc3VwcG9ydGVkXG4gKiBmaWxlc1xuICpcbiAqIE5PVEU6IG9ubHkgcG5wbSBpcyBzdXBwb3J0ZWQgYXQgdGhlIG1vbWVudFxuICovXG5leHBvcnQgY29uc3QgcmVhZFBhY2thZ2VzR2xvYnMgPSBhc3luYyAobW9ub3JlcG9Sb290OiBzdHJpbmcpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZEZpbGUoXG4gICAgICBqb2luKG1vbm9yZXBvUm9vdCwgJ3BucG0td29ya3NwYWNlLnlhbWwnKSxcbiAgICAgICd1dGYtOCdcbiAgICApO1xuICAgIGNvbnN0IHJvb3RQYXRoID0gbG9hZCh0ZXh0KSBhcyB7XG4gICAgICBwYWNrYWdlcz86IHN0cmluZ1tdO1xuICAgIH07XG4gICAgcmV0dXJuIHJvb3RQYXRoLnBhY2thZ2VzID8/IFtdO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIuZXJyb3IoZXJyKTtcbiAgICByZXR1cm4gW107XG4gIH1cbn07XG4iLCJpbXBvcnQgeyByZWFkRmlsZSwgc3RhdCwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgY29uZmlnRmlsZVBhdGggfSBmcm9tICcuLi91dGlscy9jb25maWdGaWxlUGF0aCc7XG5pbXBvcnQgeyBtb25vcmVwb1Jvb3RQYXRoIH0gZnJvbSAnLi4vdXRpbHMvbW9ub3JlcG9Sb290UGF0aCc7XG5pbXBvcnQgeyByZWFkUGFja2FnZXNHbG9icyB9IGZyb20gJy4uL3V0aWxzL3JlYWRQYWNrYWdlc0dsb2JzJztcblxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlRXNsaW50VHNDb25maWdFeGlzdHMoKSB7XG4gIGNvbnN0IHJvb3QgPSBhd2FpdCBtb25vcmVwb1Jvb3RQYXRoKCk7XG4gIGNvbnN0IGV4cGVjdGVkID0gam9pbihyb290LCAndHNjb25maWcuZXNsaW50Lmpzb24nKTtcbiAgY29uc3QgZXNsaW50Q29uZmlnRXhpc3RzID0gYXdhaXQgc3RhdChleHBlY3RlZClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcblxuICBpZiAoZXNsaW50Q29uZmlnRXhpc3RzKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShjb25maWdGaWxlUGF0aCgnZXNsaW50L3RzY29uZmlnLmVzbGludC5qc29uJyksIHtcbiAgICBlbmNvZGluZzogJ3V0Zi04JyxcbiAgfSk7XG4gIGNvbnN0IGdsb2JzID0gYXdhaXQgcmVhZFBhY2thZ2VzR2xvYnMocm9vdCk7XG4gIGF3YWl0IHdyaXRlRmlsZShcbiAgICBleHBlY3RlZCxcbiAgICB0ZXh0LnJlcGxhY2UoXG4gICAgICAnR0xPQlMnLFxuICAgICAgSlNPTi5zdHJpbmdpZnkoW1xuICAgICAgICAuLi5uZXcgU2V0KFxuICAgICAgICAgIGdsb2JzLm1hcCgoZ2xvYikgPT4gKGdsb2IgIT09ICcqJyA/IGAke2dsb2J9LyoudHNgIDogYCoudHNgKSlcbiAgICAgICAgKSxcbiAgICAgIF0pXG4gICAgKVxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVFc2xpbnRSb290Q29uZmlnRXhpc3RzKCkge1xuICBjb25zdCByb290ID0gYXdhaXQgbW9ub3JlcG9Sb290UGF0aCgpO1xuICBjb25zdCBleHBlY3RlZCA9IGpvaW4ocm9vdCwgJy5lc2xpbnRyYy5janMnKTtcbiAgY29uc3QgZXNsaW50Q29uZmlnRXhpc3RzID0gYXdhaXQgc3RhdChleHBlY3RlZClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcblxuICBpZiAoZXNsaW50Q29uZmlnRXhpc3RzKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShjb25maWdGaWxlUGF0aCgnZXNsaW50L2VzbGludC1yZWYuY2pzJyksIHtcbiAgICBlbmNvZGluZzogJ3V0Zi04JyxcbiAgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShleHBlY3RlZCwgdGV4dCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVFc2xpbnRDb25maWdGaWxlc0V4aXN0KCkge1xuICBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgZW5zdXJlRXNsaW50VHNDb25maWdFeGlzdHMoKSxcbiAgICBlbnN1cmVFc2xpbnRSb290Q29uZmlnRXhpc3RzKCksXG4gIF0pO1xufVxuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5cbmltcG9ydCB7IG1vZHVsZVJvb3REaXJlY3RvcnkgfSBmcm9tICcuL21vZHVsZVJvb3REaXJlY3RvcnknO1xuXG5leHBvcnQgZnVuY3Rpb24gbW9kdWxlc0JpblBhdGgoYmluOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGpvaW4obW9kdWxlUm9vdERpcmVjdG9yeSgpLCBgLi9ub2RlX21vZHVsZXMvLmJpbi8ke2Jpbn1gKTtcbn1cbiIsImltcG9ydCB7IHNwYXduVG9Qcm9taXNlIH0gZnJvbSAnLi4vY2hpbGQtcHJvY2Vzcyc7XG5pbXBvcnQge1xuICBpbmNsdWRlc0FueU9mLFxuICByZW1vdmVJbnB1dEFyZ3MsXG4gIHNldERlZmF1bHRBcmdzLFxufSBmcm9tICcuLi91dGlscy9jbGlBcmdzUGlwZSc7XG5pbXBvcnQgeyBjb25maWdGaWxlUGF0aCB9IGZyb20gJy4uL3V0aWxzL2NvbmZpZ0ZpbGVQYXRoJztcbmltcG9ydCB7IG1vZHVsZXNCaW5QYXRoIH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlc0JpblBhdGgnO1xuaW1wb3J0IHsgdGFza0FyZ3NQaXBlIH0gZnJvbSAnLi4vdXRpbHMvdGFza0FyZ3NQaXBlJztcblxuY29uc3QgZXNsaW50UGF0aCA9ICgpID0+IG1vZHVsZXNCaW5QYXRoKCdlc2xpbnQnKTtcblxuY29uc3QgZXNsaW50Q29uZmlnUGF0aCA9ICgpID0+IGNvbmZpZ0ZpbGVQYXRoKCcuL2VzbGludC9lc2xpbnQtcm9vdC5janMnKTtcblxuZXhwb3J0IGNvbnN0IGVzbGludCA9IGFzeW5jIChwcm9jZXNzQXJncz86IHN0cmluZ1tdKSA9PlxuICBzcGF3blRvUHJvbWlzZShcbiAgICBlc2xpbnRQYXRoKCksXG4gICAgdGFza0FyZ3NQaXBlKFxuICAgICAgW1xuICAgICAgICBzZXREZWZhdWx0QXJncyhbJy0tZm9ybWF0J10sIFsndW5peCddKSxcbiAgICAgICAgc2V0RGVmYXVsdEFyZ3MoXG4gICAgICAgICAgWyctLWV4dCddLFxuICAgICAgICAgIFtbJy50cycsICcudHN4JywgJy5qcycsICcuanN4JywgJy5janMnLCAnLmpzb24nXS5qb2luKCcsJyldXG4gICAgICAgICksXG4gICAgICAgIHNldERlZmF1bHRBcmdzKFsnLS1jb25maWcnLCAnLWMnXSwgW2VzbGludENvbmZpZ1BhdGgoKV0pLFxuICAgICAgICBzZXREZWZhdWx0QXJncyhcbiAgICAgICAgICBbJy0tZml4J10sXG4gICAgICAgICAgW10sXG4gICAgICAgICAgKGFyZ3MpID0+ICFpbmNsdWRlc0FueU9mKGFyZ3MuaW5wdXRBcmdzLCBbJy0tbm8tZml4J10pXG4gICAgICAgICksXG4gICAgICAgIC8vIHJlbW92ZSBub24tc3RhbmRhcmQgLS1uby1maXggcGFyYW1ldGVyXG4gICAgICAgIHJlbW92ZUlucHV0QXJncyhbJy0tbm8tZml4J10pLFxuICAgICAgICAoYXJncykgPT4gKHtcbiAgICAgICAgICAuLi5hcmdzLFxuICAgICAgICAgIC8vIGlmIHVzZXIgZGlkIG5vdCBzcGVjaWZ5IGZpbGVzIHRvIGxpbnQgLSBkZWZhdWx0IHRvIC5cbiAgICAgICAgICBpbnB1dEFyZ3M6IGFyZ3MuaW5wdXRBcmdzLmxlbmd0aCA9PT0gMCA/IFsnLiddIDogYXJncy5pbnB1dEFyZ3MsXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICAgIHByb2Nlc3NBcmdzXG4gICAgKSxcbiAgICB7XG4gICAgICBzdGRpbzogJ2luaGVyaXQnLFxuICAgIH1cbiAgKTtcbiIsImV4cG9ydCB0eXBlIFRhc2tPcHRzPEtleSBleHRlbmRzIHN0cmluZywgQXJncz4gPSB7XG4gIC8qKlxuICAgKiBBIGtleSBpZGVudGlmeWluZyB0YXNrIG9wdGlvbnNcbiAgICovXG4gIG5hbWU6IEtleTtcbiAgLyoqXG4gICAqIEFyZ3VtZW50cyBwYXNzZWQgYnkgdXNlciB0byB0YXNrIG9wdGlvbnMgZnVuY3Rpb25cbiAgICovXG4gIGFyZ3M6IEFyZ3M7XG5cbiAgLyoqXG4gICAqIEZ1bmN0aW9uIHRoYXQgZXhlY3V0ZXMgdGhlIHRhc2tcbiAgICovXG4gIGV4ZWN1dGU/OiBUYXNrRXhlY3V0ZUZuO1xufTtcblxuZXhwb3J0IHR5cGUgVGFza0V4ZWN1dGVGbiA9ICgpID0+IFByb21pc2U8dW5rbm93bj47XG5cbmV4cG9ydCB0eXBlIEJ1aWx0VGFza09wdHM8S2V5IGV4dGVuZHMgc3RyaW5nLCBBcmdzPiA9IFRhc2tPcHRzPEtleSwgQXJncz47XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWNsYXJlVGFzazxLZXkgZXh0ZW5kcyBzdHJpbmcsIEFyZ3M+KFxuICBvcHRzOiBUYXNrT3B0czxLZXksIEFyZ3M+XG4pOiBCdWlsdFRhc2tPcHRzPEtleSwgQXJncz4ge1xuICByZXR1cm4gb3B0cztcbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlLCBzdGF0LCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuXG5pbXBvcnQgeyBjb25maWdGaWxlUGF0aCB9IGZyb20gJy4uL3V0aWxzL2NvbmZpZ0ZpbGVQYXRoJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVuc3VyZVRzQ29uZmlnRXhpc3RzKCkge1xuICBjb25zdCBjd2RQYWNrYWdlSnNvblBhdGggPSBqb2luKHByb2Nlc3MuY3dkKCksICdwYWNrYWdlLmpzb24nKTtcbiAgY29uc3QgcGFja2FnZUpzb25FeGlzdHMgPSBhd2FpdCBzdGF0KGN3ZFBhY2thZ2VKc29uUGF0aClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcbiAgaWYgKCFwYWNrYWdlSnNvbkV4aXN0cykge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBleHBlY3RlZCA9IGpvaW4ocHJvY2Vzcy5jd2QoKSwgJ3RzY29uZmlnLmpzb24nKTtcbiAgY29uc3QgY29uZmlnRXhpc3RzID0gYXdhaXQgc3RhdChleHBlY3RlZClcbiAgICAudGhlbigocmVzdWx0KSA9PiByZXN1bHQuaXNGaWxlKCkpXG4gICAgLmNhdGNoKCgpID0+IGZhbHNlKTtcblxuICBpZiAoY29uZmlnRXhpc3RzKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkRmlsZShjb25maWdGaWxlUGF0aCgndHNjb25maWcucGtnLmpzb24nKSwge1xuICAgIGVuY29kaW5nOiAndXRmLTgnLFxuICB9KTtcbiAgYXdhaXQgd3JpdGVGaWxlKGV4cGVjdGVkLCB0ZXh0KTtcbn1cbiIsImltcG9ydCB7IGpvaW4sIHJlbGF0aXZlIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgc3Bhd25Ub1Byb21pc2UgfSBmcm9tICcuLi9jaGlsZC1wcm9jZXNzL3NwYXduVG9Qcm9taXNlJztcbmltcG9ydCB7IG1vZHVsZXNCaW5QYXRoIH0gZnJvbSAnLi4vdXRpbHMvbW9kdWxlc0JpblBhdGgnO1xuaW1wb3J0IHsgbW9ub3JlcG9Sb290UGF0aCB9IGZyb20gJy4uL3V0aWxzL21vbm9yZXBvUm9vdFBhdGgnO1xuXG5jb25zdCB0c2NQYXRoID0gKCkgPT4gbW9kdWxlc0JpblBhdGgoJ3RzYycpO1xuXG5jb25zdCB0c2MgPSBhc3luYyAoYXJnczogc3RyaW5nW10pID0+XG4gIHNwYXduVG9Qcm9taXNlKHRzY1BhdGgoKSwgYXJncywge1xuICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgLy8gYmFzZWQgb24gdGhlIG1vbm9yZXBvIFwicGFja2FnZXMvKi8qXCIgZGlyZWN0b3J5IHN0cnVjdHVyZVxuICAgIC8vIGZvciBmdWxsIHBhdGhzIGluIFR5cGVTY3JpcHQgZXJyb3JzIGp1c3QgZG8gdGhpczpcbiAgICBjd2Q6IHJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIGF3YWl0IG1vbm9yZXBvUm9vdFBhdGgoKSksXG4gIH0pO1xuXG4vLyBidWlsZGluZyBjb21wb3NpdGUgaGFzIGFuIGFkdmFudGFnZSBvZiBjYWNoaW5nIGFuZCBpbmNyZW1lbnRhbCBidWlsZHNcbi8vIGl0IGhhcyB0byB3cml0ZSBzb21ldGhpbmcgdG8gdGhlIGRpc2sgdGhvdWdoXG5cbmV4cG9ydCBjb25zdCB0c2NDb21wb3NpdGVUeXBlQ2hlY2tBdCA9IGFzeW5jIChwYWNrYWdlRGlyZWN0b3J5OiBzdHJpbmcpID0+XG4gIHRzYyhbJy0tYnVpbGQnLCBqb2luKHBhY2thZ2VEaXJlY3RvcnksICcuL3RzY29uZmlnLmpzb24nKV0pO1xuXG5leHBvcnQgY29uc3QgdHNjQ29tcG9zaXRlVHlwZUNoZWNrID0gYXN5bmMgKCkgPT5cbiAgdHNjQ29tcG9zaXRlVHlwZUNoZWNrQXQocHJvY2Vzcy5jd2QoKSk7XG4iLCJleHBvcnQgYXN5bmMgZnVuY3Rpb24gYWxsRnVsZmlsbGVkPFQgZXh0ZW5kcyByZWFkb25seSB1bmtub3duW10gfCBbXT4oXG4gIGFyZ3M6IFRcbik6IFByb21pc2U8eyAtcmVhZG9ubHkgW1AgaW4ga2V5b2YgVF06IFByb21pc2VTZXR0bGVkUmVzdWx0PEF3YWl0ZWQ8VFtQXT4+IH0+IHtcbiAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChhcmdzKTtcbiAgY29uc3QgcmVzdWx0c0FyciA9IHJlc3VsdHMgYXMgdW5rbm93biBhcyBBcnJheTxQcm9taXNlU2V0dGxlZFJlc3VsdDx1bmtub3duPj47XG4gIGZvciAoY29uc3QgcmVzdWx0IG9mIHJlc3VsdHNBcnIpIHtcbiAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ3JlamVjdGVkJykge1xuICAgICAgdGhyb3cgcmVzdWx0LnJlYXNvbjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG4iLCJpbXBvcnQgeyBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5cbmltcG9ydCB7IGVuc3VyZUVzbGludENvbmZpZ0ZpbGVzRXhpc3QgfSBmcm9tICcuL2VzbGludC9lbnN1cmVFc2xpbnRDb25maWdGaWxlc0V4aXN0JztcbmltcG9ydCB7IGVzbGludCB9IGZyb20gJy4vZXNsaW50L2VzbGludCc7XG5pbXBvcnQgeyBkZWNsYXJlVGFzayB9IGZyb20gJy4vdGFza3MvZGVjbGFyZVRhc2snO1xuaW1wb3J0IHsgZW5zdXJlVHNDb25maWdFeGlzdHMgfSBmcm9tICcuL3RzYy9lbnN1cmVUc0NvbmZpZ0V4aXN0cyc7XG5pbXBvcnQgeyB0c2NDb21wb3NpdGVUeXBlQ2hlY2sgfSBmcm9tICcuL3RzYy90c2MnO1xuaW1wb3J0IHsgYWxsRnVsZmlsbGVkIH0gZnJvbSAnLi91dGlscy9hbGxGdWxsZmlsbGVkJztcbmltcG9ydCB7IG1vbm9yZXBvUm9vdFBhdGggfSBmcm9tICcuL3V0aWxzL21vbm9yZXBvUm9vdFBhdGgnO1xuXG4vKipcbiAqIExpbnQgdXNpbmcgZXNsaW50LCBubyBjdXN0b21pemF0aW9ucyBwb3NzaWJsZSwgb3RoZXIgdGhhblxuICogdmlhIGNyZWF0aW5nIGN1c3RvbSBgZXNsaW50LmNvbmZpZy5tanNgIGluIGEgZGlyZWN0b3J5LlxuICpcbiAqIGBTdGF0dXM6IE1pbmltdW0gaW1wbGVtZW50ZWRgXG4gKlxuICogVE9ETzogQWxsb3cgc3BlY2lmeWluZyB0eXBlIG9mIHBhY2thZ2U6IHdlYiBhcHAgcmVxdWlyZXNcbiAqIGRpZmZlcmVudCBsaW50aW5nIGNvbXBhcmVkIHRvIGEgcHVibGlzaGVkIG5wbSBwYWNrYWdlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbGludChvcHRzPzogeyBwcm9jZXNzQXJnczogc3RyaW5nW10gfSkge1xuICByZXR1cm4gZGVjbGFyZVRhc2soe1xuICAgIG5hbWU6ICdsaW50JyxcbiAgICBhcmdzOiB1bmRlZmluZWQsXG4gICAgZXhlY3V0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdCA9IGF3YWl0IG1vbm9yZXBvUm9vdFBhdGgoKTtcbiAgICAgIGlmIChyb290ID09PSBwcm9jZXNzLmN3ZCgpKSB7XG4gICAgICAgIGNvbnN0IHNyY0RpciA9IGF3YWl0IHN0YXQoJy4vc3JjJykuY2F0Y2goKCkgPT4gbnVsbCk7XG4gICAgICAgIGlmICghc3JjRGlyIHx8ICFzcmNEaXIuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgYWxsRnVsZmlsbGVkKFtcbiAgICAgICAgZW5zdXJlVHNDb25maWdFeGlzdHMoKS50aGVuKCgpID0+IHRzY0NvbXBvc2l0ZVR5cGVDaGVjaygpKSxcbiAgICAgICAgZW5zdXJlRXNsaW50Q29uZmlnRmlsZXNFeGlzdCgpLnRoZW4oKCkgPT4gZXNsaW50KG9wdHM/LnByb2Nlc3NBcmdzKSksXG4gICAgICBdKTtcbiAgICB9LFxuICB9KTtcbn1cbiIsImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJztcblxuaW1wb3J0IHsgb25jZUFzeW5jIH0gZnJvbSAnLi4vdXRpbHMvb25jZUFzeW5jJztcbmltcG9ydCB0eXBlIHsgUGFja2FnZUpzb24gfSBmcm9tICcuL3BhY2thZ2VKc29uJztcblxuY29uc3QgY3dkUGFja2FnZUpzb25QYXRoID0gKCkgPT4gam9pbihwcm9jZXNzLmN3ZCgpLCAnLi9wYWNrYWdlLmpzb24nKTtcblxuYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VKc29uQXQocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICByZXR1cm4gYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0Zi04JykudGhlbihcbiAgICAocmVzdWx0KSA9PiBKU09OLnBhcnNlKHJlc3VsdCkgYXMgUGFja2FnZUpzb25cbiAgKTtcbn1cblxuZXhwb3J0IGNvbnN0IHJlYWRDd2RQYWNrYWdlSnNvbiA9IG9uY2VBc3luYygoKSA9PlxuICByZWFkUGFja2FnZUpzb25BdChjd2RQYWNrYWdlSnNvblBhdGgoKSlcbik7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkUGFja2FnZUpzb24ocGF0aDogc3RyaW5nKTogUHJvbWlzZTxQYWNrYWdlSnNvbj4ge1xuICAvLyBhc3N1bWluZyBjdXJyZW50IGRpcmVjdG9yeSBkb2Vzbid0IGNoYW5nZSB3aGlsZSBhcHAgaXMgcnVubmluZ1xuICByZXR1cm4gcHJvY2Vzcy5jd2QoKSA9PT0gY3dkUGFja2FnZUpzb25QYXRoKClcbiAgICA/IGF3YWl0IHJlYWRDd2RQYWNrYWdlSnNvbigpXG4gICAgOiBhd2FpdCByZWFkUGFja2FnZUpzb25BdChwYXRoKTtcbn1cbiIsImRlY2xhcmUgZ2xvYmFsIHtcbiAgbmFtZXNwYWNlIE5vZGVKUyB7XG4gICAgaW50ZXJmYWNlIFByb2Nlc3Mge1xuICAgICAgc2V0U291cmNlTWFwc0VuYWJsZWQ6IChlbmFibGVkOiBib29sZWFuKSA9PiB2b2lkO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZW5hYmxlU291cmNlTWFwc1N1cHBvcnQoKSB7XG4gIGlmICgnc2V0U291cmNlTWFwc0VuYWJsZWQnIGluIHByb2Nlc3MpIHtcbiAgICBwcm9jZXNzLnNldFNvdXJjZU1hcHNFbmFibGVkKHRydWUpO1xuICB9XG59XG4iLCJpbXBvcnQgeyBwZXJmb3JtYW5jZSB9IGZyb20gJ3BlcmZfaG9va3MnO1xuaW1wb3J0IHBpY28gZnJvbSAncGljb2NvbG9ycyc7XG5cbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gJy4vbG9nZ2VyL2xvZ2dlcic7XG5pbXBvcnQgeyByZWFkQ3dkUGFja2FnZUpzb24gfSBmcm9tICcuL3BhY2thZ2UtanNvbi9yZWFkUGFja2FnZUpzb24nO1xuaW1wb3J0IHR5cGUgeyBUYXNrRXhlY3V0ZUZuIH0gZnJvbSAnLi90YXNrcy9kZWNsYXJlVGFzayc7XG5pbXBvcnQgdHlwZSB7IEFsbFRhc2tUeXBlcyB9IGZyb20gJy4vdGFza1R5cGVzJztcbmltcG9ydCB7IGFsbEZ1bGZpbGxlZCB9IGZyb20gJy4vdXRpbHMvYWxsRnVsbGZpbGxlZCc7XG5pbXBvcnQgeyBlbmFibGVTb3VyY2VNYXBzU3VwcG9ydCB9IGZyb20gJy4vdXRpbHMvZW5hYmxlU291cmNlTWFwc1N1cHBvcnQnO1xuXG50eXBlIFRhc2sgPSBBbGxUYXNrVHlwZXMgfCBUYXNrRXhlY3V0ZUZuO1xuXG5jb25zdCBwb3N0VGFza05hbWVzOiBBcnJheTxBbGxUYXNrVHlwZXNbJ25hbWUnXT4gPSBbJ2NvcHknXTtcblxuY29uc3QgbWFpblRhc2tOYW1lczogQXJyYXk8QWxsVGFza1R5cGVzWyduYW1lJ10+ID0gW1xuICAnbGludCcsXG4gICdidWlsZCcsXG4gICd0ZXN0JyxcbiAgJ2RlY2xhcmF0aW9ucycsXG4gICdpbnRlZ3JhdGlvbicsXG5dO1xuXG4vKipcbiAqIERlY2xhcmUgaG93IHlvdXIgcGFja2FnZSBpcyBsaW50ZWQsIGJ1aWx0LCBidW5kbGVkIGFuZCBwdWJsaXNoZWRcbiAqIGJ5IHNwZWNpZnlpbmcgdGFzayBwYXJhbWV0ZXJzIHNwZWNpZmljIHRvIHlvdXIgcGFja2FnZS5cbiAqXG4gKiBUaGUgb3JkZXIgb2YgZXhlY3V0aW9uIG9mIHRhc2tzIGlzIGJlc3Bva2UgYW5kIGRlcGVuZHMgb24gdGhlIHRhc2suXG4gKlxuICogU29tZSB0YXNrcyBhbHNvIGFjY2VwdCBwYXJhbWV0ZXJzIGZyb20gcHJvY2Vzcy5hcmd2LCBmb3IgZXhhbXBsZVxuICogYGxpbnRgIG9yIGB0ZXN0YCBhbGxvdyB5b3UgdG8gc3BlY2lmeSB3aGljaCBmaWxlcyBuZWVkIGxpbnRpbmcgb3JcbiAqIHRlc3RpbmcuIFVzZSBgLS1oZWxwYCBwYXJhbWV0ZXIgdG8gZGV0ZXJtaW5lIHdoYXQgaXMgcG9zc2libGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwaXBlbGluZTxBcmdzIGV4dGVuZHMgW1Rhc2ssIC4uLlRhc2tbXV0+KFxuICAuLi50YXNrczogQXJnc1xuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gIHRyeSB7XG4gICAgZW5hYmxlU291cmNlTWFwc1N1cHBvcnQoKTtcblxuICAgIGNvbnN0IHsgY3VzdG9tLCBtYWluLCBwb3N0IH0gPSB0YXNrcy5yZWR1Y2U8e1xuICAgICAgY3VzdG9tOiBUYXNrW107XG4gICAgICBtYWluOiBUYXNrW107XG4gICAgICBwb3N0OiBUYXNrW107XG4gICAgfT4oXG4gICAgICAoYWNjLCB0YXNrKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgdGFzayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGFjYy5jdXN0b20ucHVzaCh0YXNrKTtcbiAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtYWluVGFza05hbWVzLmluY2x1ZGVzKHRhc2submFtZSkpIHtcbiAgICAgICAgICBhY2MubWFpbi5wdXNoKHRhc2spO1xuICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBvc3RUYXNrTmFtZXMuaW5jbHVkZXModGFzay5uYW1lKSkge1xuICAgICAgICAgIGFjYy5wb3N0LnB1c2godGFzayk7XG4gICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgY3VzdG9tOiBbXSxcbiAgICAgICAgbWFpbjogW10sXG4gICAgICAgIHBvc3Q6IFtdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBleGVjdXRlVGFzayA9IGFzeW5jICh0YXNrOiBUYXNrKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHRhc2sgPT09ICdmdW5jdGlvbidcbiAgICAgICAgICA/IGF3YWl0IHRhc2soKVxuICAgICAgICAgIDogYXdhaXQgUHJvbWlzZS5yZXNvbHZlKHRhc2suZXhlY3V0ZT8uKCkpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihlcnIpO1xuICAgICAgICBsb2dnZXIuZXJyb3IoXG4gICAgICAgICAgcGljby5yZWQoXG4gICAgICAgICAgICBgXFxuRVJST1I6IEZhaWxlZCB0byAke3Rhc2submFtZSB8fCAnZXhlY3V0ZSBhIHRhc2snfSAke1N0cmluZyhcbiAgICAgICAgICAgICAgKGF3YWl0IHJlYWRDd2RQYWNrYWdlSnNvbigpKS5uYW1lXG4gICAgICAgICAgICApfSBcIiR7ZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpfVwiYFxuICAgICAgICAgIClcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGVycik7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGF3YWl0IGFsbEZ1bGZpbGxlZChbLi4ubWFpbiwgLi4uY3VzdG9tXS5tYXAoZXhlY3V0ZVRhc2spKTtcbiAgICBhd2FpdCBhbGxGdWxmaWxsZWQocG9zdC5tYXAoZXhlY3V0ZVRhc2spKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKHR5cGVvZiBwcm9jZXNzLmV4aXRDb2RlICE9PSAnbnVtYmVyJykge1xuICAgICAgcHJvY2Vzcy5leGl0Q29kZSA9IDE7XG4gICAgfVxuICB9IGZpbmFsbHkge1xuICAgIGNvbnN0IGVuZCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIGNvbnN0IHRvU2Vjb25kcyA9ICh2YWx1ZTogbnVtYmVyKSA9PiBgJHsodmFsdWUgLyAxMDAwKS50b0ZpeGVkKDIpfXNgO1xuICAgIGxvZ2dlci5sb2coYFxcblRhc2sgdG9vayAke3RvU2Vjb25kcyhlbmQgLSBzdGFydCl9YCk7XG4gIH1cbn1cbiIsImltcG9ydCB7IENvbW1hbmQgfSBmcm9tICdjb21tYW5kZXInO1xuaW1wb3J0IHsgYmx1ZSwgeWVsbG93IH0gZnJvbSAncGljb2NvbG9ycyc7XG5cbmltcG9ydCB7IGxpbnQgfSBmcm9tICcuLi8uLi9saW50JztcbmltcG9ydCB7IHBpcGVsaW5lIH0gZnJvbSAnLi4vLi4vcGlwZWxpbmUnO1xuXG5jb25zdCBlc2xpbnQgPSAoKSA9PiB5ZWxsb3coJ2VzbGludCcpO1xuXG5jb25zdCB0c2MgPSAoKSA9PiBibHVlKCd0c2MnKTtcblxuZXhwb3J0IGNvbnN0IGxpbnRDb21tYW5kID0gKCkgPT5cbiAgbmV3IENvbW1hbmQoJ2xpbnQnKVxuICAgIC5kZXNjcmlwdGlvbihcbiAgICAgIGBMaW50IGFuZCBjaGVjayBmb3IgVHlwZVNjcmlwdCBlcnJvcnMgZm9yIHBhY2thZ2UgaW4gY3VycmVudCBkaXJlY3RvcnkgdXNpbmcgJHtlc2xpbnQoKX0gYW5kICR7dHNjKCl9YFxuICAgIClcbiAgICAuaGVscE9wdGlvbihmYWxzZSlcbiAgICAuYWRkSGVscFRleHQoXG4gICAgICAnYWZ0ZXInLFxuICAgICAgYFxcbiR7ZXNsaW50KCl9IG9wdGlvbnMgY2FuIGJlIHBhc3NlZCBpbiBhbmQgd2lsbCBiZSBmb3J3YXJkZWQsIG90aGVyd2lzZSBkZWZhdWx0IGJlc3Bva2UgY29uZmlnIGFuZCBvcHRpb25zIGFyZSB1c2VkYFxuICAgIClcbiAgICAuYWxsb3dVbmtub3duT3B0aW9uKHRydWUpXG4gICAgLmFjdGlvbihhc3luYyAoX29wdHM6IHVua25vd24sIGNvbW1hbmQ6IENvbW1hbmQpID0+IHtcbiAgICAgIGlmIChjb21tYW5kLmFyZ3MuaW5jbHVkZXMoJy1oJykgfHwgY29tbWFuZC5hcmdzLmluY2x1ZGVzKCctLWhlbHAnKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhjb21tYW5kLmhlbHBJbmZvcm1hdGlvbigpKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHBpcGVsaW5lKGxpbnQoeyBwcm9jZXNzQXJnczogY29tbWFuZC5hcmdzIH0pKTtcbiAgICB9KTtcbiIsImltcG9ydCB7IENvbW1hbmQgfSBmcm9tICdjb21tYW5kZXInO1xuXG5pbXBvcnQgeyBsaW50Q29tbWFuZCB9IGZyb20gJy4vbGludC9saW50JztcblxuZXhwb3J0IGNvbnN0IHJlcGthQ29tbWFuZCA9ICgpID0+XG4gIG5ldyBDb21tYW5kKCdyZXBrYScpLnBhc3NUaHJvdWdoT3B0aW9ucyh0cnVlKS5hZGRDb21tYW5kKGxpbnRDb21tYW5kKCkpO1xuXG5hc3luYyBmdW5jdGlvbiBydW4oKSB7XG4gIGF3YWl0IHJlcGthQ29tbWFuZCgpLnBhcnNlQXN5bmMoKTtcbn1cblxuYXdhaXQgcnVuKCk7XG4iXSwibmFtZXMiOlsiQ29tbWFuZGVyRXJyb3IiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsInJlcXVpcmUkJDAiLCJBcmd1bWVudCIsImh1bWFuUmVhZGFibGVBcmdOYW1lIiwiSGVscCIsIk9wdGlvbiIsInNwbGl0T3B0aW9uRmxhZ3MiLCJzdWdnZXN0U2ltaWxhciIsInN1Z2dlc3RTaW1pbGFyXzEiLCJwcm9jZXNzIiwicmVxdWlyZSQkNSIsInJlcXVpcmUkJDYiLCJyZXF1aXJlJCQ3IiwicmVxdWlyZSQkOCIsInJlcXVpcmUkJDkiLCJDb21tYW5kIiwicmVxdWlyZSQkMSIsInJlcXVpcmUkJDIiLCJyZXF1aXJlJCQzIiwicmVxdWlyZSQkNCIsImNvbW1hbmRlciIsInBpY29jb2xvcnNNb2R1bGUiLCJwaWNvY29sb3JzIiwiZXNsaW50IiwidHNjIiwicGljbyIsInllbGxvdyIsImJsdWUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBTUEsTUFBTUEseUJBQXVCLEtBQU0sQ0FBQTtBQUFBLEVBUWpDLFdBQUEsQ0FBWSxRQUFVLEVBQUEsSUFBQSxFQUFNLE9BQVMsRUFBQTtBQUNuQyxJQUFBLEtBQUEsQ0FBTSxPQUFPLENBQUEsQ0FBQTtBQUViLElBQU0sS0FBQSxDQUFBLGlCQUFBLENBQWtCLElBQU0sRUFBQSxJQUFBLENBQUssV0FBVyxDQUFBLENBQUE7QUFDOUMsSUFBSyxJQUFBLENBQUEsSUFBQSxHQUFPLEtBQUssV0FBWSxDQUFBLElBQUEsQ0FBQTtBQUM3QixJQUFBLElBQUEsQ0FBSyxJQUFPLEdBQUEsSUFBQSxDQUFBO0FBQ1osSUFBQSxJQUFBLENBQUssUUFBVyxHQUFBLFFBQUEsQ0FBQTtBQUNoQixJQUFBLElBQUEsQ0FBSyxXQUFjLEdBQUEsS0FBQSxDQUFBLENBQUE7QUFBQSxHQUNwQjtBQUNILENBQUE7QUFNQSxNQUFNQywrQkFBNkJELGdCQUFlLENBQUE7QUFBQSxFQU1oRCxZQUFZLE9BQVMsRUFBQTtBQUNuQixJQUFNLEtBQUEsQ0FBQSxDQUFBLEVBQUcsNkJBQTZCLE9BQU8sQ0FBQSxDQUFBO0FBRTdDLElBQU0sS0FBQSxDQUFBLGlCQUFBLENBQWtCLElBQU0sRUFBQSxJQUFBLENBQUssV0FBVyxDQUFBLENBQUE7QUFDOUMsSUFBSyxJQUFBLENBQUEsSUFB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QUEsTUFBTSxJQUFJLEVBQUEsQ0FBQTtBQUdWLEVBQUEsS0FBQSxJQUFTLENBQUksR0FBQSxDQUFBLEVBQUcsQ0FBSyxJQUFBLENBQUEsQ0FBRSxRQUFRLENBQUssRUFBQSxFQUFBO0FBQ2xDLElBQUUsQ0FBQSxDQUFBLENBQUEsQ0FBQSxHQUFLLENBQUMsQ0FBQyxDQUFBLENBQUE7QUFBQSxHQUNWO0FBRUQsRUFBQSxLQUFBLElBQVMsQ0FBSSxHQUFBLENBQUEsRUFBRyxDQUFLLElBQUEsQ0FBQSxDQUFFLFFBQVEsQ0FBSyxFQUFBLEVBQUE7QUFDbEMsSUFBQSxDQUFBLENBQUUsR0FBRyxDQUFLLENBQUEsR0FBQSxDQUFBLENBQUE7QUFBQSxHQUNYO0FBR0QsRUFBQSxLQUFBLElBQVMsQ0FBSSxHQUFBLENBQUEsRUFBRyxDQUFLLElBQUEsQ0FBQSxDQUFFLFFBQVEsQ0FBSyxFQUFBLEVBQUE7QUFDbEMsSUFBQSxLQUFBLElBQVMsQ0FBSSxHQUFBLENBQUEsRUFBRyxDQUFLLElBQUEsQ0FBQSxDQUFFLFFBQVEsQ0FBSyxFQUFBLEVBQUE7QUFDbEMsTUFBQSxJQUFJLElBQU8sR0FBQSxDQUFBLENBQUE7QUFDWCxNQUFBLElBQUksQ0FBRSxDQUFBLENBQUEsR0FBSSxDQUFPLENBQUEsS0FBQSxDQUFBLENBQUUsSUFBSSxDQUFJLENBQUEsRUFBQTtBQUN6QixRQUFPLElBQUEsR0FBQSxDQUFBLENBQUE7QUFBQSxPQUNGLE1BQUE7QUFDTCxRQUFPLElBQUEsR0FBQSxDQUFBLENBQUE7QUFBQSxPQUNSO0FBQ0QsTUFBQSxDQUFBLENBQUUsR0FBRyxDQUFLLENBQUEsR0FBQSxJQUFBLENBQUssSUFDYixDQUFFLENBQUEsQ0FBQSxHQUFJLEdBQUcsQ0FBSyxDQUFBLEdBQUEsQ0FBQSxFQUNkLEVBQUUsQ0FBRyxDQUFBLENBQUEsQ0FBQSxHQUFJLEtBQUssQ0FDZCxFQUFBLENBQUEsQ0FBRSxJQUFJLENBQUcsQ0FBQSxDQUFBLENBQUEsR0FBSSxLQUFLLElBQzFCLENBQUEsQ0FBQTtBQUVNLE1BQUEsSUFBSSxDQUFJLEdBQUEsQ0FBQSxJQUFLLENBQUksR0FBQSxDQUFBLElBQUssRUFBRSxDQUFJLEdBQUEsQ0FBQSxDQUFBLEtBQU8sQ0FBRSxDQUFBLENBQUEsR0FBSSxNQUFNLENBQUUsQ0FBQSxDQUFBLEdBQUksQ0FBTyxDQUFBLEtBQUEsQ0FBQSxDQUFFLElBQUksQ0FBSSxDQUFBLEVBQUE7QUFDcEUsUUFBQSxDQUFBLENBQUUsQ0FBRyxDQUFBLENBQUEsQ0FBQSxDQUFBLEdBQUssSUFBSyxDQUFBLEdBQUEsQ0FBSSxDQUFFLENBQUEsQ0FBQSxDQUFBLENBQUcsQ0FBSSxDQUFBLEVBQUEsQ0FBQSxDQUFFLENBQUksR0FBQSxDQUFBLENBQUEsQ0FBRyxDQUFJLEdBQUEsQ0FBQSxDQUFBLEdBQUssQ0FBQyxDQUFBLENBQUE7QUFBQSxPQUNoRDtBQUFBLEtBQ0Y7QUFBQSxHQUNGO0FBRUQsRUFBTyxPQUFBLENBQUEsQ0FBRSxDQUFFLENBQUEsTUFBQSxDQUFBLENBQVEsQ0FBRSxDQUFBLE1BQUEsQ0FBQSxDQUFBO0FBQ3ZCLENBQUE7QUFVQSxTQUFBQyxnQkFBQSxDQUF3QixNQUFNLFVBQVksRUFBQTtBQUN4QyxFQUFJLElBQUEsQ0FBQyxVQUFjLElBQUEsVUFBQSxDQUFXLE1BQVcsS0FBQSxDQUFBO0FBQUcsSUFBTyxPQUFBLEVBQUEsQ0FBQTtBQUVuRCxFQUFBLFVBQUEsR0FBYSxLQUFNLENBQUEsSUFBQSxDQUFLLElBQUksR0FBQSxDQUFJLFVBQVUsQ0FBQyxDQUFBLENBQUE7QUFFM0MsRUFBTSxNQUFBLGdCQUFBLEdBQW1CLElBQUssQ0FBQSxVQUFBLENBQVcsSUFBSSxDQUFBLENBQUE7QUFDN0MsRUFBQSxJQUFJLGdCQUFrQixFQUFBO0FBQ3BCLElBQU8sSUFBQSxHQUFBLElBQUEsQ0FBSyxNQUFNLENBQUMsQ0FBQSxDQUFBO0FBQ25CLElBQUEsVUFBQSxHQUFhLFdBQVcsR0FBSSxDQUFBLENBQUEsU0FBQSxLQUFhLFNBQVUsQ0FBQSxLQUFBLENBQU0sQ0FBQyxDQUFDLENBQUEsQ0FBQTtBQUFBLEdBQzVEO0FBRUQsRUFBQSxJQUFJLFVBQVUsRUFBQSxDQUFBO0FBQ2QsRUFBQSxJQUFJLFlBQWUsR0FBQSxXQUFBLENBQUE7QUFDbkIsRUFBQSxNQUFNLGFBQWdCLEdBQUEsR0FBQSxDQUFBO0FBQ3RCLEVBQVcsVUFBQSxDQUFBLE9BQUEsQ0FBUSxDQUFDLFNBQWMsS0FBQTtBQUNoQyxJQUFBLElBQUksVUFBVSxNQUFVLElBQUEsQ0FBQTtBQUFHLE1BQUEsT0FBQTtBQUUzQixJQUFNLE1BQUEsUUFBQSxHQUFXLFlBQWEsQ0FBQSxJQUFBLEVBQU0sU0FBUyxDQUFBLENBQUE7QUFDN0MsSUFBQSxNQUFNLFNBQVMsSUFBSyxDQUFBLEdBQUEsQ0FBSSxJQUFLLENBQUEsTUFBQSxFQUFRLFVBQVUsTUFBTSxDQUFBLENBQUE7QUFDckQsSUFBTSxNQUFBLFVBQUEsR0FBYyxVQUFTLFFBQVksSUFBQSxNQUFBLENBQUE7QUFDekMsSUFBQSxJQUFJLGFBQWEsYUFBZSxFQUFBO0FBQzlCLE1BQUEsSUFBSSxXQUFXLFlBQWMsRUFBQTtBQUUzQixRQUFlLFlBQUEsR0FBQSxRQUFBLENBQUE7QUFDZixRQUFBLE9BQUEsR0FBVSxDQUFDLFNBQVMsQ0FBQSxDQUFBO0FBQUEsT0FDNUIsTUFBQSxJQUFpQixhQUFhLFlBQWMsRUFBQTtBQUNwQyxRQUFBLE9BQUEsQ0FBUSxLQUFLLFNBQVMsQ0FBQSxDQUFBO0FBQUEsT0FDdkI7QUFBQSxLQUNGO0FBQUEsR0FDRixDQUFBLENBQUE7QUFFRCxFQUFBLE9BQUEsQ0FBUSxLQUFLLENBQUMsQ0FBQSxFQUFHLE1BQU0sQ0FBRSxDQUFBLGFBQUEsQ0FBYyxDQUFDLENBQUMsQ0FBQSxDQUFBO0FBQ3pDLEVBQUEsSUFBSSxnQkFBa0IsRUFBQTtBQUNwQixJQUFBLE9BQUEsR0FBVSxPQUFRLENBQUEsR0FBQSxDQUFJLENBQWEsU0FBQSxLQUFBLENBQUEsRUFBQSxFQUFLLFNBQVcsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLEdBQ3BEO0FBRUQsRUFBSSxJQUFBLE9BQUEsQ0FBUSxTQUFTLENBQUcsRUFBQTtBQUN0QixJQUFPLE9BQUEsQ0FBQTtBQUFBLHFCQUEwQixFQUFBLE9BQUEsQ0FBUSxLQUFLLElBQUksQ0FBQSxDQUFBLEVBQUEsQ0FBQSxDQUFBO0FBQUEsR0FDbkQ7QUFDRCxFQUFJLElBQUEsT0FBQSxDQUFRLFdBQVcsQ0FBRyxFQUFBO0FBQ3hCLElBQU8sT0FBQSxDQUFBO0FBQUEsY0FBQSxFQUFtQixPQUFRLENBQUEsQ0FBQSxDQUFBLENBQUEsRUFBQSxDQUFBLENBQUE7QUFBQSxHQUNuQztBQUNELEVBQU8sT0FBQSxFQUFBLENBQUE7QUFDVCxDQUFBO0FBRUFDLGlCQUFBLGNBQXlCLEdBQUFEOztBQ25HekIsTUFBTSxlQUFlLFVBQWtCLENBQUEsWUFBQSxDQUFBO0FBQ3ZDLE1BQU0sWUFBZSxHQUFBLFVBQUEsQ0FBQTtBQUNyQixNQUFNLElBQU8sR0FBQSxVQUFBLENBQUE7QUFDYixNQUFNLEVBQUssR0FBQSxVQUFBLENBQUE7QUFDWCxNQUFNRSxTQUFVLEdBQUEsVUFBQSxDQUFBO0FBRWhCLE1BQU0sWUFBRVAsWUFBVSxvQkFBeUIsRUFBQSxHQUFBUSxRQUFBLENBQUE7QUFDM0MsTUFBTSxrQkFBRVgsZ0JBQW1CLEVBQUEsR0FBQVksS0FBQSxDQUFBO0FBQzNCLE1BQU0sUUFBRVAsTUFBUyxFQUFBLEdBQUFRLElBQUEsQ0FBQTtBQUNqQixNQUFNLFVBQUVQLFVBQVEsZ0JBQXFCLEVBQUEsR0FBQVEsTUFBQSxDQUFBO0FBQ3JDLE1BQU0sRUFBRSxjQUFtQixFQUFBLEdBQUFDLGdCQUFBLENBQUE7QUFJM0IsTUFBTUMsa0JBQWdCLFlBQWEsQ0FBQTtBQUFBLEVBT2pDLFlBQVksSUFBTSxFQUFBO0FBQ2hCO0FBRUEsSUFBQSxJQUFBLENBQUssV0FBVztBQUVoQixJQUFBLElBQUEsQ0FBSyxVQUFVO0FBQ2YsSUFBQSxJQUFBLENBQUssTUFBUyxHQUFBLElBQUEsQ0FBQTtBQUNkLElBQUEsSUFBQSxDQUFLLG1CQUFzQixHQUFBLEtBQUEsQ0FBQTtBQUMzQixJQUFBLElBQUEsQ0FBSyxxQkFBd0IsR0FBQSxJQUFBLENBQUE7QUFFN0IsSUFBQSxJQUFBLENBQUssUUFBUTtBQUViLElBQUEsSUFBQSxDQUFLLE9BQU87QUFDWixJQUFBLElBQUEsQ0FBSyxVQUFVO0FBQ2YsSUFBQSxJQUFBLENBQUssZ0JBQWdCO0FBQ3JCLElBQUEsSUFBQSxDQUFLLFdBQWMsR0FBQSxJQUFBLENBQUE7QUFDbkIsSUFBQSxJQUFBLENBQUssUUFBUSxJQUFRLElBQUEsRUFBQSxDQUFBO0FBQ3JCLElBQUEsSUFBQSxDQUFLLGdCQUFnQjtBQUNyQixJQUFBLElBQUEsQ0FBSyxzQkFBc0I7QUFDM0IsSUFBQSxJQUFBLENBQUsseUJBQTRCLEdBQUEsS0FBQSxDQUFBO0FBQ2pDLElBQUEsSUFBQSxDQUFLLGNBQWlCLEdBQUEsSUFBQSxDQUFBO0FBQ3RCLElBQUEsSUFBQSxDQUFLLGtCQUFxQixHQUFBLEtBQUEsQ0FBQTtBQUMxQixJQUFBLElBQUEsQ0FBSyxlQUFrQixHQUFBLElBQUEsQ0FBQTtBQUN2QixJQUFBLElBQUEsQ0FBSyxjQUFpQixHQUFBLElBQUEsQ0FBQTtBQUN0QixJQUFBLElBQUEsQ0FBSyxtQkFBc0IsR0FBQSxJQUFBLENBQUE7QUFDM0IsSUFBQSxJQUFBLENBQUssYUFBZ0IsR0FBQSxJQUFBLENBQUE7QUFDckIsSUFBQSxJQUFBLENBQUssV0FBVztBQUNoQixJQUFBLElBQUEsQ0FBSyw0QkFBK0IsR0FBQSxJQUFBLENBQUE7QUFDcEMsSUFBQSxJQUFBLENBQUssWUFBZSxHQUFBLEVBQUEsQ0FBQTtBQUNwQixJQUFBLElBQUEsQ0FBSyxnQkFBbUIsR0FBQSxLQUFBLENBQUEsQ0FBQTtBQUN4QixJQUFBLElBQUEsQ0FBSyx3QkFBMkIsR0FBQSxLQUFBLENBQUE7QUFDaEMsSUFBQSxJQUFBLENBQUssbUJBQXNCLEdBQUEsS0FBQSxDQUFBO0FBQzNCLElBQUEsSUFBQSxDQUFLLGtCQUFrQjtBQUV2QixJQUFBLElBQUEsQ0FBSyxtQkFBc0IsR0FBQSxLQUFBLENBQUE7QUFDM0IsSUFBQSxJQUFBLENBQUsseUJBQTRCLEdBQUEsSUFBQSxDQUFBO0FBR2pDLElBQUEsSUFBQSxDQUFLLG9CQUF1QixHQUFBO0FBQUEsTUFDMUIsVUFBVSxDQUFDLEdBQUEsS0FBUU4sU0FBUSxDQUFBLE1BQUEsQ0FBTyxNQUFNLEdBQUcsQ0FBQTtBQUFBLE1BQzNDLFVBQVUsQ0FBQyxHQUFBLEtBQVFBLFNBQVEsQ0FBQSxNQUFBLENBQU8sTUFBTSxHQUFHLENBQUE7QUFBQSxNQUMzQyxpQkFBaUIsTUFBTUEsU0FBQSxDQUFRLE9BQU8sS0FBUSxHQUFBQSxTQUFBLENBQVEsT0FBTyxPQUFVLEdBQUEsS0FBQSxDQUFBO0FBQUEsTUFDdkUsaUJBQWlCLE1BQU1BLFNBQUEsQ0FBUSxPQUFPLEtBQVEsR0FBQUEsU0FBQSxDQUFRLE9BQU8sT0FBVSxHQUFBLEtBQUEsQ0FBQTtBQUFBLE1BQ3ZFLFdBQWEsRUFBQSxDQUFDLEdBQUssRUFBQSxLQUFBLEtBQVUsTUFBTSxHQUFHLENBQUE7QUFBQSxLQUM1QyxDQUFBO0FBRUksSUFBQSxJQUFBLENBQUssT0FBVSxHQUFBLEtBQUEsQ0FBQTtBQUNmLElBQUEsSUFBQSxDQUFLLGNBQWlCLEdBQUEsSUFBQSxDQUFBO0FBQ3RCLElBQUEsSUFBQSxDQUFLLFVBQWEsR0FBQSxZQUFBLENBQUE7QUFDbEIsSUFBQSxJQUFBLENBQUssZ0JBQW1CLEdBQUEsMEJBQUEsQ0FBQTtBQUN4QixJQUFBLElBQUEsQ0FBSyxjQUFpQixHQUFBLElBQUEsQ0FBQTtBQUN0QixJQUFBLElBQUEsQ0FBSyxhQUFnQixHQUFBLFFBQUEsQ0FBQTtBQUNyQixJQUFBLElBQUEsQ0FBSyx1QkFBMEIsR0FBQSxLQUFBLENBQUEsQ0FBQTtBQUMvQixJQUFBLElBQUEsQ0FBSyxnQkFBbUIsR0FBQSxNQUFBLENBQUE7QUFDeEIsSUFBQSxJQUFBLENBQUssdUJBQTBCLEdBQUEsZ0JBQUEsQ0FBQTtBQUMvQixJQUFBLElBQUEsQ0FBSyx1QkFBMEIsR0FBQSwwQkFBQSxDQUFBO0FBQy9CLElBQUEsSUFBQSxDQUFLLHFCQUFxQjtHQUMzQjtBQUFBLEVBVUQsc0JBQXNCLGFBQWUsRUFBQTtBQUNuQyxJQUFBLElBQUEsQ0FBSyx1QkFBdUIsYUFBYyxDQUFBLG9CQUFBLENBQUE7QUFDMUMsSUFBQSxJQUFBLENBQUssaUJBQWlCLGFBQWMsQ0FBQSxjQUFBLENBQUE7QUFDcEMsSUFBQSxJQUFBLENBQUssYUFBYSxhQUFjLENBQUEsVUFBQSxDQUFBO0FBQ2hDLElBQUEsSUFBQSxDQUFLLG1CQUFtQixhQUFjLENBQUEsZ0JBQUEsQ0FBQTtBQUN0QyxJQUFBLElBQUEsQ0FBSyxpQkFBaUIsYUFBYyxDQUFBLGNBQUEsQ0FBQTtBQUNwQyxJQUFBLElBQUEsQ0FBSyxnQkFBZ0IsYUFBYyxDQUFBLGFBQUEsQ0FBQTtBQUNuQyxJQUFBLElBQUEsQ0FBSyxtQkFBbUIsYUFBYyxDQUFBLGdCQUFBLENBQUE7QUFDdEMsSUFBQSxJQUFBLENBQUssMEJBQTBCLGFBQWMsQ0FBQSx1QkFBQSxDQUFBO0FBQzdDLElBQUEsSUFBQSxDQUFLLDBCQUEwQixhQUFjLENBQUEsdUJBQUEsQ0FBQTtBQUM3QyxJQUFBLElBQUEsQ0FBSyxxQkFBcUIsYUFBYyxDQUFBLGtCQUFBLENBQUE7QUFDeEMsSUFBQSxJQUFBLENBQUssZ0JBQWdCLGFBQWMsQ0FBQSxhQUFBLENBQUE7QUFDbkMsSUFBQSxJQUFBLENBQUssNEJBQTRCLGFBQWMsQ0FBQSx5QkFBQSxDQUFBO0FBQy9DLElBQUEsSUFBQSxDQUFLLCtCQUErQixhQUFjLENBQUEsNEJBQUEsQ0FBQTtBQUNsRCxJQUFBLElBQUEsQ0FBSyx3QkFBd0IsYUFBYyxDQUFBLHFCQUFBLENBQUE7QUFDM0MsSUFBQSxJQUFBLENBQUssMkJBQTJCLGFBQWMsQ0FBQSx3QkFBQSxDQUFBO0FBQzlDLElBQUEsSUFBQSxDQUFLLHNCQUFzQixhQUFjLENBQUEsbUJBQUEsQ0FBQTtBQUN6QyxJQUFBLElBQUEsQ0FBSyw0QkFBNEIsYUFBYyxDQUFBLHlCQUFBLENBQUE7QUFFL0MsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQTJCRCxPQUFBLENBQVEsV0FBYSxFQUFBLG9CQUFBLEVBQXNCLFFBQVUsRUFBQTtBQUNuRCxJQUFBLElBQUksSUFBTyxHQUFBLG9CQUFBLENBQUE7QUFDWCxJQUFBLElBQUksSUFBTyxHQUFBLFFBQUEsQ0FBQTtBQUNYLElBQUEsSUFBSSxPQUFPLElBQUEsS0FBUyxRQUFZLElBQUEsSUFBQSxLQUFTLElBQU0sRUFBQTtBQUM3QyxNQUFPLElBQUEsR0FBQSxJQUFBLENBQUE7QUFDUCxNQUFPLElBQUEsR0FBQSxJQUFBLENBQUE7QUFBQSxLQUNSO0FBQ0QsSUFBQSxJQUFBLEdBQU8sUUFBUTtBQUNmLElBQUEsTUFBTSxHQUFHLElBQUEsRUFBTSxJQUFRLENBQUEsR0FBQSxXQUFBLENBQVksTUFBTSxlQUFlLENBQUEsQ0FBQTtBQUV4RCxJQUFNLE1BQUEsR0FBQSxHQUFNLElBQUssQ0FBQSxhQUFBLENBQWMsSUFBSSxDQUFBLENBQUE7QUFDbkMsSUFBQSxJQUFJLElBQU0sRUFBQTtBQUNSLE1BQUEsR0FBQSxDQUFJLFlBQVksSUFBSSxDQUFBLENBQUE7QUFDcEIsTUFBQSxHQUFBLENBQUksa0JBQXFCLEdBQUEsSUFBQSxDQUFBO0FBQUEsS0FDMUI7QUFDRCxJQUFBLElBQUksSUFBSyxDQUFBLFNBQUE7QUFBVyxNQUFBLElBQUEsQ0FBSyxzQkFBc0IsR0FBSSxDQUFBLEtBQUEsQ0FBQTtBQUNuRCxJQUFBLEdBQUEsQ0FBSSxPQUFVLEdBQUEsQ0FBQyxFQUFFLElBQUEsQ0FBSyxVQUFVLElBQUssQ0FBQSxNQUFBLENBQUEsQ0FBQTtBQUNyQyxJQUFJLEdBQUEsQ0FBQSxlQUFBLEdBQWtCLEtBQUssY0FBa0IsSUFBQSxJQUFBLENBQUE7QUFDN0MsSUFBSSxJQUFBLElBQUE7QUFBTSxNQUFBLEdBQUEsQ0FBSSxVQUFVLElBQUksQ0FBQSxDQUFBO0FBQzVCLElBQUssSUFBQSxDQUFBLFFBQUEsQ0FBUyxLQUFLLEdBQUcsQ0FBQSxDQUFBO0FBQ3RCLElBQUEsR0FBQSxDQUFJLE1BQVMsR0FBQSxJQUFBLENBQUE7QUFDYixJQUFBLEdBQUEsQ0FBSSxzQkFBc0IsSUFBSSxDQUFBLENBQUE7QUFFOUIsSUFBSSxJQUFBLElBQUE7QUFBTSxNQUFPLE9BQUEsSUFBQSxDQUFBO0FBQ2pCLElBQU8sT0FBQSxHQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFZRCxjQUFjLElBQU0sRUFBQTtBQUNsQixJQUFPLE9BQUEsSUFBSU0sVUFBUSxJQUFJLENBQUEsQ0FBQTtBQUFBLEdBQ3hCO0FBQUEsRUFTRCxVQUFhLEdBQUE7QUFDWCxJQUFBLE9BQU8sT0FBTyxNQUFPLENBQUEsSUFBSVgsUUFBUSxFQUFBLElBQUEsQ0FBSyxlQUFlLENBQUEsQ0FBQTtBQUFBLEdBQ3REO0FBQUEsRUFVRCxjQUFjLGFBQWUsRUFBQTtBQUMzQixJQUFBLElBQUksYUFBa0IsS0FBQSxLQUFBLENBQUE7QUFBVyxNQUFBLE9BQU8sSUFBSyxDQUFBLGtCQUFBLENBQUE7QUFFN0MsSUFBQSxJQUFBLENBQUssa0JBQXFCLEdBQUEsYUFBQSxDQUFBO0FBQzFCLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFxQkQsZ0JBQWdCLGFBQWUsRUFBQTtBQUM3QixJQUFBLElBQUksYUFBa0IsS0FBQSxLQUFBLENBQUE7QUFBVyxNQUFBLE9BQU8sSUFBSyxDQUFBLG9CQUFBLENBQUE7QUFFN0MsSUFBTyxNQUFBLENBQUEsTUFBQSxDQUFPLElBQUssQ0FBQSxvQkFBQSxFQUFzQixhQUFhLENBQUEsQ0FBQTtBQUN0RCxJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBUUQsa0JBQUEsQ0FBbUIsY0FBYyxJQUFNLEVBQUE7QUFDckMsSUFBQSxJQUFJLE9BQU8sV0FBZ0IsS0FBQSxRQUFBO0FBQVUsTUFBQSxXQUFBLEdBQWMsQ0FBQyxDQUFDLFdBQUEsQ0FBQTtBQUNyRCxJQUFBLElBQUEsQ0FBSyxtQkFBc0IsR0FBQSxXQUFBLENBQUE7QUFDM0IsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVFELHdCQUFBLENBQXlCLG9CQUFvQixJQUFNLEVBQUE7QUFDakQsSUFBSyxJQUFBLENBQUEseUJBQUEsR0FBNEIsQ0FBQyxDQUFDLGlCQUFBLENBQUE7QUFDbkMsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVlELFVBQUEsQ0FBVyxLQUFLLElBQU0sRUFBQTtBQUNwQixJQUFJLElBQUEsQ0FBQyxJQUFJLEtBQU8sRUFBQTtBQUNkLE1BQUEsTUFBTSxJQUFJLEtBQU0sQ0FBQSxDQUFBO0FBQUEsMERBQ3FDLENBQUEsQ0FBQSxDQUFBO0FBQUEsS0FDdEQ7QUFFRCxJQUFBLElBQUEsR0FBTyxRQUFRO0FBQ2YsSUFBQSxJQUFJLElBQUssQ0FBQSxTQUFBO0FBQVcsTUFBQSxJQUFBLENBQUssc0JBQXNCLEdBQUksQ0FBQSxLQUFBLENBQUE7QUFDbkQsSUFBSSxJQUFBLElBQUEsQ0FBSyxVQUFVLElBQUssQ0FBQSxNQUFBO0FBQVEsTUFBQSxHQUFBLENBQUksT0FBVSxHQUFBLElBQUEsQ0FBQTtBQUU5QyxJQUFLLElBQUEsQ0FBQSxRQUFBLENBQVMsS0FBSyxHQUFHLENBQUEsQ0FBQTtBQUN0QixJQUFBLEdBQUEsQ0FBSSxNQUFTLEdBQUEsSUFBQSxDQUFBO0FBQ2IsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQWFELGNBQUEsQ0FBZSxNQUFNLFdBQWEsRUFBQTtBQUNoQyxJQUFPLE9BQUEsSUFBSUYsVUFBUyxDQUFBLElBQUEsRUFBTSxXQUFXLENBQUEsQ0FBQTtBQUFBLEdBQ3RDO0FBQUEsRUFrQkQsUUFBUyxDQUFBLElBQUEsRUFBTSxXQUFhLEVBQUEsRUFBQSxFQUFJLFlBQWMsRUFBQTtBQUM1QyxJQUFBLE1BQU0sUUFBVyxHQUFBLElBQUEsQ0FBSyxjQUFlLENBQUEsSUFBQSxFQUFNLFdBQVcsQ0FBQSxDQUFBO0FBQ3RELElBQUksSUFBQSxPQUFPLE9BQU8sVUFBWSxFQUFBO0FBQzVCLE1BQUEsUUFBQSxDQUFTLE9BQVEsQ0FBQSxZQUFZLENBQUUsQ0FBQSxTQUFBLENBQVUsRUFBRSxDQUFBLENBQUE7QUFBQSxLQUN0QyxNQUFBO0FBQ0wsTUFBQSxRQUFBLENBQVMsUUFBUSxFQUFFLENBQUEsQ0FBQTtBQUFBLEtBQ3BCO0FBQ0QsSUFBQSxJQUFBLENBQUssWUFBWSxRQUFRLENBQUEsQ0FBQTtBQUN6QixJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBY0QsVUFBVSxLQUFPLEVBQUE7QUFDZixJQUFBLEtBQUEsQ0FBTSxLQUFNLENBQUEsSUFBSSxDQUFFLENBQUEsT0FBQSxDQUFRLENBQUMsTUFBVyxLQUFBO0FBQ3BDLE1BQUEsSUFBQSxDQUFLLFNBQVMsTUFBTSxDQUFBLENBQUE7QUFBQSxLQUNyQixDQUFBLENBQUE7QUFDRCxJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBUUQsWUFBWSxRQUFVLEVBQUE7QUFDcEIsSUFBQSxNQUFNLGdCQUFtQixHQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsS0FBQSxDQUFNLEVBQUUsQ0FBRSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQzlDLElBQUksSUFBQSxnQkFBQSxJQUFvQixpQkFBaUIsUUFBVSxFQUFBO0FBQ2pELE1BQUEsTUFBTSxJQUFJLEtBQUEsQ0FBTSxDQUEyQyx3Q0FBQSxFQUFBLGdCQUFBLENBQWlCLE1BQVMsQ0FBQSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQUEsS0FDdEY7QUFDRCxJQUFBLElBQUksU0FBUyxRQUFZLElBQUEsUUFBQSxDQUFTLGlCQUFpQixLQUFhLENBQUEsSUFBQSxRQUFBLENBQVMsYUFBYSxLQUFXLENBQUEsRUFBQTtBQUMvRixNQUFBLE1BQU0sSUFBSSxLQUFBLENBQU0sQ0FBMkQsd0RBQUEsRUFBQSxRQUFBLENBQVMsTUFBUyxDQUFBLENBQUEsQ0FBQSxDQUFBLENBQUE7QUFBQSxLQUM5RjtBQUNELElBQUssSUFBQSxDQUFBLEtBQUEsQ0FBTSxLQUFLLFFBQVEsQ0FBQSxDQUFBO0FBQ3hCLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFZRCxjQUFBLENBQWUscUJBQXFCLFdBQWEsRUFBQTtBQUMvQyxJQUFBLElBQUksd0JBQXdCLEtBQU8sRUFBQTtBQUNqQyxNQUFBLElBQUEsQ0FBSyx1QkFBMEIsR0FBQSxLQUFBLENBQUE7QUFBQSxLQUMxQixNQUFBO0FBQ0wsTUFBQSxJQUFBLENBQUssdUJBQTBCLEdBQUEsSUFBQSxDQUFBO0FBQy9CLE1BQUksSUFBQSxPQUFPLHdCQUF3QixRQUFVLEVBQUE7QUFDM0MsUUFBQSxJQUFBLENBQUssZ0JBQW1CLEdBQUEsbUJBQUEsQ0FBb0IsS0FBTSxDQUFBLEdBQUcsQ0FBRSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQ3ZELFFBQUEsSUFBQSxDQUFLLHVCQUEwQixHQUFBLG1CQUFBLENBQUE7QUFBQSxPQUNoQztBQUNELE1BQUssSUFBQSxDQUFBLHVCQUFBLEdBQTBCLGVBQWUsSUFBSyxDQUFBLHVCQUFBLENBQUE7QUFBQSxLQUNwRDtBQUNELElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFPRCx1QkFBMEIsR0FBQTtBQUN4QixJQUFJLElBQUEsSUFBQSxDQUFLLDRCQUE0QixLQUFXLENBQUEsRUFBQTtBQUM5QyxNQUFPLE9BQUEsSUFBQSxDQUFLLFNBQVMsTUFBVSxJQUFBLENBQUMsS0FBSyxjQUFrQixJQUFBLENBQUMsSUFBSyxDQUFBLFlBQUEsQ0FBYSxNQUFNLENBQUEsQ0FBQTtBQUFBLEtBQ2pGO0FBQ0QsSUFBQSxPQUFPLElBQUssQ0FBQSx1QkFBQSxDQUFBO0FBQUEsR0FDYjtBQUFBLEVBVUQsSUFBQSxDQUFLLE9BQU8sUUFBVSxFQUFBO0FBQ3BCLElBQU0sTUFBQSxhQUFBLEdBQWdCLENBQUMsV0FBQSxFQUFhLFlBQVksQ0FBQSxDQUFBO0FBQ2hELElBQUEsSUFBSSxDQUFDLGFBQUEsQ0FBYyxRQUFTLENBQUEsS0FBSyxDQUFHLEVBQUE7QUFDbEMsTUFBTSxNQUFBLElBQUksTUFBTSxDQUFnRCw2Q0FBQSxFQUFBLEtBQUEsQ0FBQTtBQUFBLGtCQUNsRCxFQUFBLGFBQUEsQ0FBYyxJQUFLLENBQUEsTUFBTSxDQUFJLENBQUEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLEtBQzVDO0FBQ0QsSUFBSSxJQUFBLElBQUEsQ0FBSyxnQkFBZ0IsS0FBUSxDQUFBLEVBQUE7QUFDL0IsTUFBSyxJQUFBLENBQUEsZUFBQSxDQUFnQixLQUFPLENBQUEsQ0FBQSxJQUFBLENBQUssUUFBUSxDQUFBLENBQUE7QUFBQSxLQUNwQyxNQUFBO0FBQ0wsTUFBSyxJQUFBLENBQUEsZUFBQSxDQUFnQixLQUFTLENBQUEsR0FBQSxDQUFDLFFBQVEsQ0FBQSxDQUFBO0FBQUEsS0FDeEM7QUFDRCxJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBU0QsYUFBYSxFQUFJLEVBQUE7QUFDZixJQUFBLElBQUksRUFBSSxFQUFBO0FBQ04sTUFBQSxJQUFBLENBQUssYUFBZ0IsR0FBQSxFQUFBLENBQUE7QUFBQSxLQUNoQixNQUFBO0FBQ0wsTUFBSyxJQUFBLENBQUEsYUFBQSxHQUFnQixDQUFDLEdBQVEsS0FBQTtBQUM1QixRQUFJLElBQUEsR0FBQSxDQUFJLFNBQVMsa0NBQW9DLEVBQUE7QUFDbkQsVUFBTSxNQUFBLEdBQUEsQ0FBQTtBQUFBLFNBR1A7QUFBQSxPQUNULENBQUE7QUFBQSxLQUNLO0FBQ0QsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVlELEtBQUEsQ0FBTSxRQUFVLEVBQUEsSUFBQSxFQUFNLE9BQVMsRUFBQTtBQUM3QixJQUFBLElBQUksS0FBSyxhQUFlLEVBQUE7QUFDdEIsTUFBQSxJQUFBLENBQUssY0FBYyxJQUFJSCxnQkFBQSxDQUFlLFFBQVUsRUFBQSxJQUFBLEVBQU0sT0FBTyxDQUFDLENBQUEsQ0FBQTtBQUFBLEtBRS9EO0FBQ0QsSUFBQVUsU0FBQSxDQUFRLEtBQUssUUFBUSxDQUFBLENBQUE7QUFBQSxHQUN0QjtBQUFBLEVBaUJELE9BQU8sRUFBSSxFQUFBO0FBQ1QsSUFBTSxNQUFBLFFBQUEsR0FBVyxDQUFDLElBQVMsS0FBQTtBQUV6QixNQUFNLE1BQUEsaUJBQUEsR0FBb0IsS0FBSyxLQUFNLENBQUEsTUFBQSxDQUFBO0FBQ3JDLE1BQUEsTUFBTSxVQUFhLEdBQUEsSUFBQSxDQUFLLEtBQU0sQ0FBQSxDQUFBLEVBQUcsaUJBQWlCLENBQUEsQ0FBQTtBQUNsRCxNQUFBLElBQUksS0FBSyx5QkFBMkIsRUFBQTtBQUNsQyxRQUFBLFVBQUEsQ0FBVyxpQkFBcUIsQ0FBQSxHQUFBLElBQUEsQ0FBQTtBQUFBLE9BQzNCLE1BQUE7QUFDTCxRQUFXLFVBQUEsQ0FBQSxpQkFBQSxDQUFBLEdBQXFCLEtBQUssSUFBSSxFQUFBLENBQUE7QUFBQSxPQUMxQztBQUNELE1BQUEsVUFBQSxDQUFXLEtBQUssSUFBSSxDQUFBLENBQUE7QUFFcEIsTUFBTyxPQUFBLEVBQUEsQ0FBRyxLQUFNLENBQUEsSUFBQSxFQUFNLFVBQVUsQ0FBQSxDQUFBO0FBQUEsS0FDdEMsQ0FBQTtBQUNJLElBQUEsSUFBQSxDQUFLLGNBQWlCLEdBQUEsUUFBQSxDQUFBO0FBQ3RCLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFhRCxZQUFBLENBQWEsT0FBTyxXQUFhLEVBQUE7QUFDL0IsSUFBTyxPQUFBLElBQUlKLFFBQU8sQ0FBQSxLQUFBLEVBQU8sV0FBVyxDQUFBLENBQUE7QUFBQSxHQUNyQztBQUFBLEVBUUQsVUFBVSxNQUFRLEVBQUE7QUFDaEIsSUFBTSxNQUFBLEtBQUEsR0FBUSxPQUFPO0FBQ3JCLElBQU0sTUFBQSxJQUFBLEdBQU8sT0FBTztBQUdwQixJQUFBLElBQUksT0FBTyxNQUFRLEVBQUE7QUFFakIsTUFBQSxNQUFNLGdCQUFtQixHQUFBLE1BQUEsQ0FBTyxJQUFLLENBQUEsT0FBQSxDQUFRLFVBQVUsSUFBSSxDQUFBLENBQUE7QUFDM0QsTUFBQSxJQUFJLENBQUMsSUFBQSxDQUFLLFdBQVksQ0FBQSxnQkFBZ0IsQ0FBRyxFQUFBO0FBQ3ZDLFFBQUssSUFBQSxDQUFBLHdCQUFBLENBQXlCLE1BQU0sTUFBTyxDQUFBLFlBQUEsS0FBaUIsU0FBWSxJQUFPLEdBQUEsTUFBQSxDQUFPLGNBQWMsU0FBUyxDQUFBLENBQUE7QUFBQSxPQUM5RztBQUFBLEtBQ1AsTUFBQSxJQUFlLE1BQU8sQ0FBQSxZQUFBLEtBQWlCLEtBQVcsQ0FBQSxFQUFBO0FBQzVDLE1BQUEsSUFBQSxDQUFLLHdCQUF5QixDQUFBLElBQUEsRUFBTSxNQUFPLENBQUEsWUFBQSxFQUFjLFNBQVMsQ0FBQSxDQUFBO0FBQUEsS0FDbkU7QUFHRCxJQUFLLElBQUEsQ0FBQSxPQUFBLENBQVEsS0FBSyxNQUFNLENBQUEsQ0FBQTtBQUd4QixJQUFBLE1BQU0saUJBQW9CLEdBQUEsQ0FBQyxHQUFLLEVBQUEsbUJBQUEsRUFBcUIsV0FBZ0IsS0FBQTtBQUduRSxNQUFBLElBQUksR0FBTyxJQUFBLElBQUEsSUFBUSxNQUFPLENBQUEsU0FBQSxLQUFjLEtBQVcsQ0FBQSxFQUFBO0FBQ2pELFFBQUEsR0FBQSxHQUFNLE1BQU8sQ0FBQSxTQUFBLENBQUE7QUFBQSxPQUNkO0FBR0QsTUFBTSxNQUFBLFFBQUEsR0FBVyxJQUFLLENBQUEsY0FBQSxDQUFlLElBQUksQ0FBQSxDQUFBO0FBQ3pDLE1BQUksSUFBQSxHQUFBLEtBQVEsSUFBUSxJQUFBLE1BQUEsQ0FBTyxRQUFVLEVBQUE7QUFDbkMsUUFBSSxJQUFBO0FBQ0YsVUFBTSxHQUFBLEdBQUEsTUFBQSxDQUFPLFFBQVMsQ0FBQSxHQUFBLEVBQUssUUFBUSxDQUFBLENBQUE7QUFBQSxpQkFDNUIsR0FBUCxFQUFBO0FBQ0EsVUFBSSxJQUFBLEdBQUEsQ0FBSSxTQUFTLDJCQUE2QixFQUFBO0FBQzVDLFlBQU0sTUFBQSxPQUFBLEdBQVUsQ0FBRyxFQUFBLG1CQUFBLENBQUEsQ0FBQSxFQUF1QixHQUFJLENBQUEsT0FBQSxDQUFBLENBQUEsQ0FBQTtBQUM5QyxZQUFLLElBQUEsQ0FBQSxLQUFBLENBQU0sU0FBUyxFQUFFLFFBQUEsRUFBVSxJQUFJLFFBQVUsRUFBQSxJQUFBLEVBQU0sR0FBSSxDQUFBLElBQUEsRUFBTSxDQUFBLENBQUE7QUFBQSxXQUMvRDtBQUNELFVBQU0sTUFBQSxHQUFBLENBQUE7QUFBQSxTQUNQO0FBQUEsT0FDUSxNQUFBLElBQUEsR0FBQSxLQUFRLElBQVEsSUFBQSxNQUFBLENBQU8sUUFBVSxFQUFBO0FBQzFDLFFBQU0sR0FBQSxHQUFBLE1BQUEsQ0FBTyxZQUFhLENBQUEsR0FBQSxFQUFLLFFBQVEsQ0FBQSxDQUFBO0FBQUEsT0FDeEM7QUFHRCxNQUFBLElBQUksT0FBTyxJQUFNLEVBQUE7QUFDZixRQUFBLElBQUksT0FBTyxNQUFRLEVBQUE7QUFDakIsVUFBTSxHQUFBLEdBQUEsS0FBQSxDQUFBO0FBQUEsU0FDRyxNQUFBLElBQUEsTUFBQSxDQUFPLGVBQWUsT0FBTyxRQUFVLEVBQUE7QUFDaEQsVUFBTSxHQUFBLEdBQUEsSUFBQSxDQUFBO0FBQUEsU0FDRCxNQUFBO0FBQ0wsVUFBTSxHQUFBLEdBQUEsRUFBQSxDQUFBO0FBQUEsU0FDUDtBQUFBLE9BQ0Y7QUFDRCxNQUFLLElBQUEsQ0FBQSx3QkFBQSxDQUF5QixJQUFNLEVBQUEsR0FBQSxFQUFLLFdBQVcsQ0FBQSxDQUFBO0FBQUEsS0FDMUQsQ0FBQTtBQUVJLElBQUEsSUFBQSxDQUFLLEVBQUcsQ0FBQSxTQUFBLEdBQVksS0FBTyxFQUFBLENBQUMsR0FBUSxLQUFBO0FBQ2xDLE1BQU0sTUFBQSxtQkFBQSxHQUFzQixDQUFrQixlQUFBLEVBQUEsTUFBQSxDQUFPLEtBQW9CLENBQUEsWUFBQSxFQUFBLEdBQUEsQ0FBQSxhQUFBLENBQUEsQ0FBQTtBQUN6RSxNQUFrQixpQkFBQSxDQUFBLEdBQUEsRUFBSyxxQkFBcUIsS0FBSyxDQUFBLENBQUE7QUFBQSxLQUNsRCxDQUFBLENBQUE7QUFFRCxJQUFBLElBQUksT0FBTyxNQUFRLEVBQUE7QUFDakIsTUFBQSxJQUFBLENBQUssRUFBRyxDQUFBLFlBQUEsR0FBZSxLQUFPLEVBQUEsQ0FBQyxHQUFRLEtBQUE7QUFDckMsUUFBQSxNQUFNLG1CQUFzQixHQUFBLENBQUEsZUFBQSxFQUFrQixNQUFPLENBQUEsS0FBQSxDQUFBLFNBQUEsRUFBaUIsa0JBQWtCLE1BQU8sQ0FBQSxNQUFBLENBQUEsYUFBQSxDQUFBLENBQUE7QUFDL0YsUUFBa0IsaUJBQUEsQ0FBQSxHQUFBLEVBQUsscUJBQXFCLEtBQUssQ0FBQSxDQUFBO0FBQUEsT0FDbEQsQ0FBQSxDQUFBO0FBQUEsS0FDRjtBQUVELElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFPRCxTQUFVLENBQUEsTUFBQSxFQUFRLEtBQU8sRUFBQSxXQUFBLEVBQWEsSUFBSSxZQUFjLEVBQUE7QUFDdEQsSUFBQSxJQUFJLE9BQU8sS0FBQSxLQUFVLFFBQVksSUFBQSxLQUFBLFlBQWlCQSxRQUFRLEVBQUE7QUFDeEQsTUFBTSxNQUFBLElBQUksTUFBTSxpRkFBaUYsQ0FBQSxDQUFBO0FBQUEsS0FDbEc7QUFDRCxJQUFBLE1BQU0sTUFBUyxHQUFBLElBQUEsQ0FBSyxZQUFhLENBQUEsS0FBQSxFQUFPLFdBQVcsQ0FBQSxDQUFBO0FBQ25ELElBQUEsTUFBQSxDQUFPLG1CQUFvQixDQUFBLENBQUMsQ0FBQyxNQUFBLENBQU8sU0FBUyxDQUFBLENBQUE7QUFDN0MsSUFBSSxJQUFBLE9BQU8sT0FBTyxVQUFZLEVBQUE7QUFDNUIsTUFBQSxNQUFBLENBQU8sT0FBUSxDQUFBLFlBQVksQ0FBRSxDQUFBLFNBQUEsQ0FBVSxFQUFFLENBQUEsQ0FBQTtBQUFBLEtBQy9DLE1BQUEsSUFBZSxjQUFjLE1BQVEsRUFBQTtBQUUvQixNQUFBLE1BQU0sS0FBUSxHQUFBLEVBQUEsQ0FBQTtBQUNkLE1BQUssRUFBQSxHQUFBLENBQUMsS0FBSyxHQUFRLEtBQUE7QUFDakIsUUFBTSxNQUFBLENBQUEsR0FBSSxLQUFNLENBQUEsSUFBQSxDQUFLLEdBQUcsQ0FBQSxDQUFBO0FBQ3hCLFFBQU8sT0FBQSxDQUFBLEdBQUksRUFBRSxDQUFLLENBQUEsR0FBQSxHQUFBLENBQUE7QUFBQSxPQUMxQixDQUFBO0FBQ00sTUFBQSxNQUFBLENBQU8sT0FBUSxDQUFBLFlBQVksQ0FBRSxDQUFBLFNBQUEsQ0FBVSxFQUFFLENBQUEsQ0FBQTtBQUFBLEtBQ3BDLE1BQUE7QUFDTCxNQUFBLE1BQUEsQ0FBTyxRQUFRLEVBQUUsQ0FBQSxDQUFBO0FBQUEsS0FDbEI7QUFFRCxJQUFPLE9BQUEsSUFBQSxDQUFLLFVBQVUsTUFBTSxDQUFBLENBQUE7QUFBQSxHQUM3QjtBQUFBLEVBb0RELE1BQU8sQ0FBQSxLQUFBLEVBQU8sV0FBYSxFQUFBLEVBQUEsRUFBSSxZQUFjLEVBQUE7QUFDM0MsSUFBQSxPQUFPLEtBQUssU0FBVSxDQUFBLElBQUksS0FBTyxFQUFBLFdBQUEsRUFBYSxJQUFJLFlBQVksQ0FBQSxDQUFBO0FBQUEsR0FDL0Q7QUFBQSxFQWVELGNBQWUsQ0FBQSxLQUFBLEVBQU8sV0FBYSxFQUFBLEVBQUEsRUFBSSxZQUFjLEVBQUE7QUFDbkQsSUFBTyxPQUFBLElBQUEsQ0FBSyxVQUFVLEVBQUUsU0FBQSxFQUFXLE1BQVEsRUFBQSxLQUFBLEVBQU8sV0FBYSxFQUFBLEVBQUEsRUFBSSxZQUFZLENBQUEsQ0FBQTtBQUFBLEdBQ2hGO0FBQUEsRUFZRCwyQkFBQSxDQUE0QixVQUFVLElBQU0sRUFBQTtBQUMxQyxJQUFLLElBQUEsQ0FBQSw0QkFBQSxHQUErQixDQUFDLENBQUMsT0FBQSxDQUFBO0FBQ3RDLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFRRCxrQkFBQSxDQUFtQixlQUFlLElBQU0sRUFBQTtBQUN0QyxJQUFLLElBQUEsQ0FBQSxtQkFBQSxHQUFzQixDQUFDLENBQUMsWUFBQSxDQUFBO0FBQzdCLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFRRCxvQkFBQSxDQUFxQixjQUFjLElBQU0sRUFBQTtBQUN2QyxJQUFLLElBQUEsQ0FBQSxxQkFBQSxHQUF3QixDQUFDLENBQUMsV0FBQSxDQUFBO0FBQy9CLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFTRCx1QkFBQSxDQUF3QixhQUFhLElBQU0sRUFBQTtBQUN6QyxJQUFLLElBQUEsQ0FBQSx3QkFBQSxHQUEyQixDQUFDLENBQUMsVUFBQSxDQUFBO0FBQ2xDLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFXRCxrQkFBQSxDQUFtQixjQUFjLElBQU0sRUFBQTtBQUNyQyxJQUFLLElBQUEsQ0FBQSxtQkFBQSxHQUFzQixDQUFDLENBQUMsV0FBQSxDQUFBO0FBQzdCLElBQUksSUFBQSxDQUFDLENBQUMsSUFBSyxDQUFBLE1BQUEsSUFBVSxlQUFlLENBQUMsSUFBQSxDQUFLLE9BQU8sd0JBQTBCLEVBQUE7QUFDekUsTUFBTSxNQUFBLElBQUksTUFBTSxxR0FBcUcsQ0FBQSxDQUFBO0FBQUEsS0FDdEg7QUFDRCxJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBVUQsd0JBQUEsQ0FBeUIsb0JBQW9CLElBQU0sRUFBQTtBQUNqRCxJQUFLLElBQUEsQ0FBQSx5QkFBQSxHQUE0QixDQUFDLENBQUMsaUJBQUEsQ0FBQTtBQUNuQyxJQUFJLElBQUEsSUFBQSxDQUFLLFFBQVEsTUFBUSxFQUFBO0FBQ3ZCLE1BQU0sTUFBQSxJQUFJLE1BQU0sd0RBQXdELENBQUEsQ0FBQTtBQUFBLEtBQ3pFO0FBQ0QsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVNELGVBQWUsR0FBSyxFQUFBO0FBQ2xCLElBQUEsSUFBSSxLQUFLLHlCQUEyQixFQUFBO0FBQ2xDLE1BQUEsT0FBTyxJQUFLLENBQUEsR0FBQSxDQUFBLENBQUE7QUFBQSxLQUNiO0FBQ0QsSUFBQSxPQUFPLEtBQUssYUFBYyxDQUFBLEdBQUEsQ0FBQSxDQUFBO0FBQUEsR0FDM0I7QUFBQSxFQVVELGNBQUEsQ0FBZSxLQUFLLEtBQU8sRUFBQTtBQUN6QixJQUFBLElBQUksS0FBSyx5QkFBMkIsRUFBQTtBQUNsQyxNQUFBLElBQUEsQ0FBSyxHQUFPLENBQUEsR0FBQSxLQUFBLENBQUE7QUFBQSxLQUNQLE1BQUE7QUFDTCxNQUFBLElBQUEsQ0FBSyxjQUFjLEdBQU8sQ0FBQSxHQUFBLEtBQUEsQ0FBQTtBQUFBLEtBQzNCO0FBQ0QsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVdELHdCQUFBLENBQXlCLEdBQUssRUFBQSxLQUFBLEVBQU8sTUFBUSxFQUFBO0FBQzNDLElBQUssSUFBQSxDQUFBLGNBQUEsQ0FBZSxLQUFLLEtBQUssQ0FBQSxDQUFBO0FBQzlCLElBQUEsSUFBQSxDQUFLLG9CQUFvQixHQUFPLENBQUEsR0FBQSxNQUFBLENBQUE7QUFDaEMsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVVELHFCQUFxQixHQUFLLEVBQUE7QUFDeEIsSUFBQSxPQUFPLEtBQUssbUJBQW9CLENBQUEsR0FBQSxDQUFBLENBQUE7QUFBQSxHQUNqQztBQUFBLEVBU0QsZ0JBQUEsQ0FBaUIsTUFBTSxZQUFjLEVBQUE7QUFDbkMsSUFBQSxJQUFJLFNBQVMsS0FBYSxDQUFBLElBQUEsQ0FBQyxLQUFNLENBQUEsT0FBQSxDQUFRLElBQUksQ0FBRyxFQUFBO0FBQzlDLE1BQU0sTUFBQSxJQUFJLE1BQU0scURBQXFELENBQUEsQ0FBQTtBQUFBLEtBQ3RFO0FBQ0QsSUFBQSxZQUFBLEdBQWUsZ0JBQWdCO0FBRy9CLElBQUEsSUFBSSxTQUFTLEtBQVcsQ0FBQSxFQUFBO0FBQ3RCLE1BQUEsSUFBQSxHQUFPSSxTQUFRLENBQUEsSUFBQSxDQUFBO0FBRWYsTUFBQSxJQUFJQSxTQUFRLENBQUEsUUFBQSxJQUFZQSxTQUFRLENBQUEsUUFBQSxDQUFTLFFBQVUsRUFBQTtBQUNqRCxRQUFBLFlBQUEsQ0FBYSxJQUFPLEdBQUEsVUFBQSxDQUFBO0FBQUEsT0FDckI7QUFBQSxLQUNGO0FBQ0QsSUFBSyxJQUFBLENBQUEsT0FBQSxHQUFVLEtBQUs7QUFHcEIsSUFBSSxJQUFBLFFBQUEsQ0FBQTtBQUNKLElBQUEsUUFBUSxZQUFhLENBQUEsSUFBQTtBQUFBLE1BQ2QsS0FBQSxLQUFBLENBQUEsQ0FBQTtBQUFBLE1BQ0EsS0FBQSxNQUFBO0FBQ0gsUUFBQSxJQUFBLENBQUssY0FBYyxJQUFLLENBQUEsQ0FBQSxDQUFBLENBQUE7QUFDeEIsUUFBVyxRQUFBLEdBQUEsSUFBQSxDQUFLLE1BQU0sQ0FBQyxDQUFBLENBQUE7QUFDdkIsUUFBQSxNQUFBO0FBQUEsTUFDRyxLQUFBLFVBQUE7QUFFSCxRQUFBLElBQUlBLFVBQVEsVUFBWSxFQUFBO0FBQ3RCLFVBQUEsSUFBQSxDQUFLLGNBQWMsSUFBSyxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQ3hCLFVBQVcsUUFBQSxHQUFBLElBQUEsQ0FBSyxNQUFNLENBQUMsQ0FBQSxDQUFBO0FBQUEsU0FDbEIsTUFBQTtBQUNMLFVBQVcsUUFBQSxHQUFBLElBQUEsQ0FBSyxNQUFNLENBQUMsQ0FBQSxDQUFBO0FBQUEsU0FDeEI7QUFDRCxRQUFBLE1BQUE7QUFBQSxNQUNHLEtBQUEsTUFBQTtBQUNILFFBQVcsUUFBQSxHQUFBLElBQUEsQ0FBSyxNQUFNLENBQUMsQ0FBQSxDQUFBO0FBQ3ZCLFFBQUEsTUFBQTtBQUFBLE1BQUE7QUFFQSxRQUFBLE1BQU0sSUFBSSxLQUFBLENBQU0sQ0FBb0MsaUNBQUEsRUFBQSxZQUFBLENBQWEsSUFBUyxDQUFBLEdBQUEsQ0FBQSxDQUFBLENBQUE7QUFBQSxLQUFBO0FBSTlFLElBQUksSUFBQSxDQUFDLElBQUssQ0FBQSxLQUFBLElBQVMsSUFBSyxDQUFBLFdBQUE7QUFBYSxNQUFLLElBQUEsQ0FBQSxnQkFBQSxDQUFpQixLQUFLLFdBQVcsQ0FBQSxDQUFBO0FBQzNFLElBQUssSUFBQSxDQUFBLEtBQUEsR0FBUSxLQUFLLEtBQVMsSUFBQSxTQUFBLENBQUE7QUFFM0IsSUFBTyxPQUFBLFFBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQW1CRCxLQUFBLENBQU0sTUFBTSxZQUFjLEVBQUE7QUFDeEIsSUFBQSxNQUFNLFFBQVcsR0FBQSxJQUFBLENBQUssZ0JBQWlCLENBQUEsSUFBQSxFQUFNLFlBQVksQ0FBQSxDQUFBO0FBQ3pELElBQUssSUFBQSxDQUFBLGFBQUEsQ0FBYyxJQUFJLFFBQVEsQ0FBQSxDQUFBO0FBRS9CLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFxQkQsTUFBTSxVQUFXLENBQUEsSUFBQSxFQUFNLFlBQWMsRUFBQTtBQUNuQyxJQUFBLE1BQU0sUUFBVyxHQUFBLElBQUEsQ0FBSyxnQkFBaUIsQ0FBQSxJQUFBLEVBQU0sWUFBWSxDQUFBLENBQUE7QUFDekQsSUFBQSxNQUFNLElBQUssQ0FBQSxhQUFBLENBQWMsRUFBRSxFQUFFLFFBQVEsQ0FBQSxDQUFBO0FBRXJDLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFRRCxrQkFBQSxDQUFtQixZQUFZLElBQU0sRUFBQTtBQUNuQyxJQUFBLElBQUEsR0FBTyxLQUFLO0FBQ1osSUFBQSxJQUFJLGNBQWlCLEdBQUEsS0FBQSxDQUFBO0FBQ3JCLElBQUEsTUFBTSxZQUFZLENBQUMsS0FBQSxFQUFPLEtBQU8sRUFBQSxNQUFBLEVBQVEsUUFBUSxNQUFNLENBQUEsQ0FBQTtBQUV2RCxJQUFBLFNBQUEsUUFBQSxDQUFrQixTQUFTLFFBQVUsRUFBQTtBQUVuQyxNQUFBLE1BQU0sUUFBVyxHQUFBLElBQUEsQ0FBSyxPQUFRLENBQUEsT0FBQSxFQUFTLFFBQVEsQ0FBQSxDQUFBO0FBQy9DLE1BQUksSUFBQSxFQUFBLENBQUcsV0FBVyxRQUFRLENBQUE7QUFBRyxRQUFPLE9BQUEsUUFBQSxDQUFBO0FBR3BDLE1BQUEsSUFBSSxTQUFVLENBQUEsUUFBQSxDQUFTLElBQUssQ0FBQSxPQUFBLENBQVEsUUFBUSxDQUFDLENBQUE7QUFBRyxRQUFPLE9BQUEsS0FBQSxDQUFBLENBQUE7QUFHdkQsTUFBTSxNQUFBLFFBQUEsR0FBVyxVQUFVLElBQUssQ0FBQSxDQUFBLEdBQUEsS0FBTyxHQUFHLFVBQVcsQ0FBQSxDQUFBLEVBQUcsUUFBVyxDQUFBLEVBQUEsR0FBQSxDQUFBLENBQUssQ0FBQyxDQUFBLENBQUE7QUFDekUsTUFBSSxJQUFBLFFBQUE7QUFBVSxRQUFBLE9BQU8sR0FBRyxRQUFXLENBQUEsRUFBQSxRQUFBLENBQUEsQ0FBQSxDQUFBO0FBRW5DLE1BQU8sT0FBQSxLQUFBLENBQUEsQ0FBQTtBQUFBLEtBQ1I7QUFHRCxJQUFBLElBQUEsQ0FBSyxnQ0FBZ0MsRUFBQSxDQUFBO0FBQ3JDLElBQUEsSUFBQSxDQUFLLDJCQUEyQixFQUFBLENBQUE7QUFHaEMsSUFBQSxJQUFJLGlCQUFpQixVQUFXLENBQUEsZUFBQSxJQUFtQixDQUFHLEVBQUEsSUFBQSxDQUFLLFNBQVMsVUFBVyxDQUFBLEtBQUEsQ0FBQSxDQUFBLENBQUE7QUFDL0UsSUFBSSxJQUFBLGFBQUEsR0FBZ0IsS0FBSyxjQUFrQixJQUFBLEVBQUEsQ0FBQTtBQUMzQyxJQUFBLElBQUksS0FBSyxXQUFhLEVBQUE7QUFDcEIsTUFBSSxJQUFBLGtCQUFBLENBQUE7QUFDSixNQUFJLElBQUE7QUFDRixRQUFxQixrQkFBQSxHQUFBLEVBQUEsQ0FBRyxZQUFhLENBQUEsSUFBQSxDQUFLLFdBQVcsQ0FBQSxDQUFBO0FBQUEsZUFDOUMsR0FBUCxFQUFBO0FBQ0EsUUFBQSxrQkFBQSxHQUFxQixJQUFLLENBQUEsV0FBQSxDQUFBO0FBQUEsT0FDM0I7QUFDRCxNQUFBLGFBQUEsR0FBZ0IsS0FBSyxPQUFRLENBQUEsSUFBQSxDQUFLLE9BQVEsQ0FBQSxrQkFBa0IsR0FBRyxhQUFhLENBQUEsQ0FBQTtBQUFBLEtBQzdFO0FBR0QsSUFBQSxJQUFJLGFBQWUsRUFBQTtBQUNqQixNQUFJLElBQUEsU0FBQSxHQUFZLFFBQVMsQ0FBQSxhQUFBLEVBQWUsY0FBYyxDQUFBLENBQUE7QUFHdEQsTUFBQSxJQUFJLENBQUMsU0FBYSxJQUFBLENBQUMsVUFBVyxDQUFBLGVBQUEsSUFBbUIsS0FBSyxXQUFhLEVBQUE7QUFDakUsUUFBTSxNQUFBLFVBQUEsR0FBYSxLQUFLLFFBQVMsQ0FBQSxJQUFBLENBQUssYUFBYSxJQUFLLENBQUEsT0FBQSxDQUFRLElBQUssQ0FBQSxXQUFXLENBQUMsQ0FBQSxDQUFBO0FBQ2pGLFFBQUksSUFBQSxVQUFBLEtBQWUsS0FBSyxLQUFPLEVBQUE7QUFDN0IsVUFBQSxTQUFBLEdBQVksUUFBUyxDQUFBLGFBQUEsRUFBZSxDQUFHLEVBQUEsVUFBQSxDQUFBLENBQUEsRUFBYyxXQUFXLEtBQU8sQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLFNBQ3hFO0FBQUEsT0FDRjtBQUNELE1BQUEsY0FBQSxHQUFpQixTQUFhLElBQUEsY0FBQSxDQUFBO0FBQUEsS0FDL0I7QUFFRCxJQUFBLGNBQUEsR0FBaUIsU0FBVSxDQUFBLFFBQUEsQ0FBUyxJQUFLLENBQUEsT0FBQSxDQUFRLGNBQWMsQ0FBQyxDQUFBLENBQUE7QUFFaEUsSUFBSSxJQUFBLElBQUEsQ0FBQTtBQUNKLElBQUksSUFBQUEsU0FBQSxDQUFRLGFBQWEsT0FBUyxFQUFBO0FBQ2hDLE1BQUEsSUFBSSxjQUFnQixFQUFBO0FBQ2xCLFFBQUEsSUFBQSxDQUFLLFFBQVEsY0FBYyxDQUFBLENBQUE7QUFFM0IsUUFBQSxJQUFBLEdBQU8sMEJBQTJCLENBQUFBLFNBQUEsQ0FBUSxRQUFRLENBQUEsQ0FBRSxPQUFPLElBQUksQ0FBQSxDQUFBO0FBRS9ELFFBQU8sSUFBQSxHQUFBLFlBQUEsQ0FBYSxNQUFNQSxTQUFRLENBQUEsSUFBQSxDQUFLLElBQUksSUFBTSxFQUFBLEVBQUUsS0FBTyxFQUFBLFNBQUEsRUFBVyxDQUFBLENBQUE7QUFBQSxPQUNoRSxNQUFBO0FBQ0wsUUFBQSxJQUFBLEdBQU8sYUFBYSxLQUFNLENBQUEsY0FBQSxFQUFnQixNQUFNLEVBQUUsS0FBQSxFQUFPLFdBQVcsQ0FBQSxDQUFBO0FBQUEsT0FDckU7QUFBQSxLQUNJLE1BQUE7QUFDTCxNQUFBLElBQUEsQ0FBSyxRQUFRLGNBQWMsQ0FBQSxDQUFBO0FBRTNCLE1BQUEsSUFBQSxHQUFPLDBCQUEyQixDQUFBQSxTQUFBLENBQVEsUUFBUSxDQUFBLENBQUUsT0FBTyxJQUFJLENBQUEsQ0FBQTtBQUMvRCxNQUFPLElBQUEsR0FBQSxZQUFBLENBQWEsTUFBTUEsU0FBUSxDQUFBLFFBQUEsRUFBVSxNQUFNLEVBQUUsS0FBQSxFQUFPLFdBQVcsQ0FBQSxDQUFBO0FBQUEsS0FDdkU7QUFFRCxJQUFJLElBQUEsQ0FBQyxLQUFLLE1BQVEsRUFBQTtBQUNoQixNQUFBLE1BQU0sVUFBVSxDQUFDLFNBQUEsRUFBVyxTQUFXLEVBQUEsU0FBQSxFQUFXLFVBQVUsUUFBUSxDQUFBLENBQUE7QUFDcEUsTUFBUSxPQUFBLENBQUEsT0FBQSxDQUFRLENBQUMsTUFBVyxLQUFBO0FBRTFCLFFBQVFBLFNBQUEsQ0FBQSxFQUFBLENBQUcsUUFBUSxNQUFNO0FBQ3ZCLFVBQUEsSUFBSSxJQUFLLENBQUEsTUFBQSxLQUFXLEtBQVMsSUFBQSxJQUFBLENBQUssYUFBYSxJQUFNLEVBQUE7QUFDbkQsWUFBQSxJQUFBLENBQUssS0FBSyxNQUFNLENBQUEsQ0FBQTtBQUFBLFdBQ2pCO0FBQUEsU0FDRixDQUFBLENBQUE7QUFBQSxPQUNGLENBQUEsQ0FBQTtBQUFBLEtBQ0Y7QUFJRCxJQUFBLE1BQU0sZUFBZSxJQUFLLENBQUEsYUFBQSxDQUFBO0FBQzFCLElBQUEsSUFBSSxDQUFDLFlBQWMsRUFBQTtBQUNqQixNQUFBLElBQUEsQ0FBSyxHQUFHLE9BQVMsRUFBQUEsU0FBQSxDQUFRLElBQUssQ0FBQSxJQUFBLENBQUtBLFNBQU8sQ0FBQyxDQUFBLENBQUE7QUFBQSxLQUN0QyxNQUFBO0FBQ0wsTUFBSyxJQUFBLENBQUEsRUFBQSxDQUFHLFNBQVMsTUFBTTtBQUNyQixRQUFBLFlBQUEsQ0FBYSxJQUFJVixnQkFBZSxDQUFBVSxTQUFBLENBQVEsWUFBWSxDQUFHLEVBQUEsa0NBQUEsRUFBb0MsU0FBUyxDQUFDLENBQUEsQ0FBQTtBQUFBLE9BQ3RHLENBQUEsQ0FBQTtBQUFBLEtBQ0Y7QUFDRCxJQUFLLElBQUEsQ0FBQSxFQUFBLENBQUcsT0FBUyxFQUFBLENBQUMsR0FBUSxLQUFBO0FBRXhCLE1BQUksSUFBQSxHQUFBLENBQUksU0FBUyxRQUFVLEVBQUE7QUFDekIsUUFBTSxNQUFBLG9CQUFBLEdBQXVCLGFBQ3pCLEdBQUEsQ0FBQSxxREFBQSxFQUF3RCxhQUN4RCxDQUFBLENBQUEsQ0FBQSxHQUFBLGlHQUFBLENBQUE7QUFDSixRQUFBLE1BQU0sb0JBQW9CLENBQUksQ0FBQSxFQUFBLGNBQUEsQ0FBQTtBQUFBLE9BQUEsRUFDN0IsVUFBVyxDQUFBLEtBQUEsQ0FBQTtBQUFBO0FBQUEsR0FFZixFQUFBLG9CQUFBLENBQUEsQ0FBQSxDQUFBO0FBQ0csUUFBTSxNQUFBLElBQUksTUFBTSxpQkFBaUIsQ0FBQSxDQUFBO0FBQUEsT0FFekMsTUFBQSxJQUFpQixHQUFJLENBQUEsSUFBQSxLQUFTLFFBQVUsRUFBQTtBQUNoQyxRQUFNLE1BQUEsSUFBSSxLQUFNLENBQUEsQ0FBQSxDQUFBLEVBQUksY0FBZ0MsQ0FBQSxnQkFBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLE9BQ3JEO0FBQ0QsTUFBQSxJQUFJLENBQUMsWUFBYyxFQUFBO0FBQ2pCLFFBQUFBLFNBQUEsQ0FBUSxLQUFLLENBQUMsQ0FBQSxDQUFBO0FBQUEsT0FDVCxNQUFBO0FBQ0wsUUFBQSxNQUFNLFlBQWUsR0FBQSxJQUFJVixnQkFBZSxDQUFBLENBQUEsRUFBRyxvQ0FBb0MsU0FBUyxDQUFBLENBQUE7QUFDeEYsUUFBQSxZQUFBLENBQWEsV0FBYyxHQUFBLEdBQUEsQ0FBQTtBQUMzQixRQUFBLFlBQUEsQ0FBYSxZQUFZLENBQUEsQ0FBQTtBQUFBLE9BQzFCO0FBQUEsS0FDRixDQUFBLENBQUE7QUFHRCxJQUFBLElBQUEsQ0FBSyxjQUFpQixHQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ3ZCO0FBQUEsRUFNRCxtQkFBQSxDQUFvQixXQUFhLEVBQUEsUUFBQSxFQUFVLE9BQVMsRUFBQTtBQUNsRCxJQUFNLE1BQUEsVUFBQSxHQUFhLElBQUssQ0FBQSxZQUFBLENBQWEsV0FBVyxDQUFBLENBQUE7QUFDaEQsSUFBQSxJQUFJLENBQUMsVUFBQTtBQUFZLE1BQUEsSUFBQSxDQUFLLElBQUssQ0FBQSxFQUFFLEtBQU8sRUFBQSxJQUFBLEVBQU0sQ0FBQSxDQUFBO0FBRTFDLElBQUEsSUFBSSxXQUFXLGtCQUFvQixFQUFBO0FBQ2pDLE1BQUEsSUFBQSxDQUFLLGtCQUFtQixDQUFBLFVBQUEsRUFBWSxRQUFTLENBQUEsTUFBQSxDQUFPLE9BQU8sQ0FBQyxDQUFBLENBQUE7QUFBQSxLQUN2RCxNQUFBO0FBQ0wsTUFBTyxPQUFBLFVBQUEsQ0FBVyxhQUFjLENBQUEsUUFBQSxFQUFVLE9BQU8sQ0FBQSxDQUFBO0FBQUEsS0FDbEQ7QUFBQSxHQUNGO0FBQUEsRUFRRCx1QkFBMEIsR0FBQTtBQUV4QixJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsT0FBQSxDQUFRLENBQUMsR0FBQSxFQUFLLENBQU0sS0FBQTtBQUM3QixNQUFBLElBQUksR0FBSSxDQUFBLFFBQUEsSUFBWSxJQUFLLENBQUEsSUFBQSxDQUFLLE1BQU0sSUFBTSxFQUFBO0FBQ3hDLFFBQUssSUFBQSxDQUFBLGVBQUEsQ0FBZ0IsR0FBSSxDQUFBLElBQUEsRUFBTSxDQUFBLENBQUE7QUFBQSxPQUNoQztBQUFBLEtBQ0YsQ0FBQSxDQUFBO0FBRUQsSUFBSSxJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsTUFBQSxHQUFTLENBQUssSUFBQSxJQUFBLENBQUssTUFBTSxJQUFLLENBQUEsS0FBQSxDQUFNLE1BQVMsR0FBQSxDQUFBLENBQUEsQ0FBRyxRQUFVLEVBQUE7QUFDdkUsTUFBQSxPQUFBO0FBQUEsS0FDRDtBQUNELElBQUEsSUFBSSxJQUFLLENBQUEsSUFBQSxDQUFLLE1BQVMsR0FBQSxJQUFBLENBQUssTUFBTSxNQUFRLEVBQUE7QUFDeEMsTUFBSyxJQUFBLENBQUEsZ0JBQUEsQ0FBaUIsS0FBSyxJQUFJLENBQUEsQ0FBQTtBQUFBLEtBQ2hDO0FBQUEsR0FDRjtBQUFBLEVBUUQsaUJBQW9CLEdBQUE7QUFDbEIsSUFBQSxNQUFNLFVBQWEsR0FBQSxDQUFDLFFBQVUsRUFBQSxLQUFBLEVBQU8sUUFBYSxLQUFBO0FBRWhELE1BQUEsSUFBSSxXQUFjLEdBQUEsS0FBQSxDQUFBO0FBQ2xCLE1BQUksSUFBQSxLQUFBLEtBQVUsSUFBUSxJQUFBLFFBQUEsQ0FBUyxRQUFVLEVBQUE7QUFDdkMsUUFBSSxJQUFBO0FBQ0YsVUFBYyxXQUFBLEdBQUEsUUFBQSxDQUFTLFFBQVMsQ0FBQSxLQUFBLEVBQU8sUUFBUSxDQUFBLENBQUE7QUFBQSxpQkFDeEMsR0FBUCxFQUFBO0FBQ0EsVUFBSSxJQUFBLEdBQUEsQ0FBSSxTQUFTLDJCQUE2QixFQUFBO0FBQzVDLFlBQUEsTUFBTSxVQUFVLENBQWtDLCtCQUFBLEVBQUEsS0FBQSxDQUFBLDJCQUFBLEVBQW1DLFFBQVMsQ0FBQSxJQUFBLFFBQVksR0FBSSxDQUFBLE9BQUEsQ0FBQSxDQUFBLENBQUE7QUFDOUcsWUFBSyxJQUFBLENBQUEsS0FBQSxDQUFNLFNBQVMsRUFBRSxRQUFBLEVBQVUsSUFBSSxRQUFVLEVBQUEsSUFBQSxFQUFNLEdBQUksQ0FBQSxJQUFBLEVBQU0sQ0FBQSxDQUFBO0FBQUEsV0FDL0Q7QUFDRCxVQUFNLE1BQUEsR0FBQSxDQUFBO0FBQUEsU0FDUDtBQUFBLE9BQ0Y7QUFDRCxNQUFPLE9BQUEsV0FBQSxDQUFBO0FBQUEsS0FDYixDQUFBO0FBRUksSUFBQSxJQUFBLENBQUssdUJBQXVCLEVBQUEsQ0FBQTtBQUU1QixJQUFBLE1BQU0sZ0JBQWdCLEVBQUEsQ0FBQTtBQUN0QixJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsT0FBQSxDQUFRLENBQUMsV0FBQSxFQUFhLEtBQVUsS0FBQTtBQUN6QyxNQUFBLElBQUksUUFBUSxXQUFZLENBQUEsWUFBQSxDQUFBO0FBQ3hCLE1BQUEsSUFBSSxZQUFZLFFBQVUsRUFBQTtBQUV4QixRQUFJLElBQUEsS0FBQSxHQUFRLElBQUssQ0FBQSxJQUFBLENBQUssTUFBUSxFQUFBO0FBQzVCLFVBQVEsS0FBQSxHQUFBLElBQUEsQ0FBSyxJQUFLLENBQUEsS0FBQSxDQUFNLEtBQUssQ0FBQSxDQUFBO0FBQzdCLFVBQUEsSUFBSSxZQUFZLFFBQVUsRUFBQTtBQUN4QixZQUFBLEtBQUEsR0FBUSxLQUFNLENBQUEsTUFBQSxDQUFPLENBQUMsU0FBQSxFQUFXLENBQU0sS0FBQTtBQUNyQyxjQUFPLE9BQUEsVUFBQSxDQUFXLFdBQWEsRUFBQSxDQUFBLEVBQUcsU0FBUyxDQUFBLENBQUE7QUFBQSxhQUN6RCxFQUFlLFlBQVksWUFBWSxDQUFBLENBQUE7QUFBQSxXQUM1QjtBQUFBLFNBQ1gsTUFBQSxJQUFtQixVQUFVLEtBQVcsQ0FBQSxFQUFBO0FBQzlCLFVBQUEsS0FBQSxHQUFRLEVBQUEsQ0FBQTtBQUFBLFNBQ1Q7QUFBQSxPQUNRLE1BQUEsSUFBQSxLQUFBLEdBQVEsSUFBSyxDQUFBLElBQUEsQ0FBSyxNQUFRLEVBQUE7QUFDbkMsUUFBQSxLQUFBLEdBQVEsS0FBSyxJQUFLLENBQUEsS0FBQSxDQUFBLENBQUE7QUFDbEIsUUFBQSxJQUFJLFlBQVksUUFBVSxFQUFBO0FBQ3hCLFVBQUEsS0FBQSxHQUFRLFVBQVcsQ0FBQSxXQUFBLEVBQWEsS0FBTyxFQUFBLFdBQUEsQ0FBWSxZQUFZLENBQUEsQ0FBQTtBQUFBLFNBQ2hFO0FBQUEsT0FDRjtBQUNELE1BQUEsYUFBQSxDQUFjLEtBQVMsQ0FBQSxHQUFBLEtBQUEsQ0FBQTtBQUFBLEtBQ3hCLENBQUEsQ0FBQTtBQUNELElBQUEsSUFBQSxDQUFLLGFBQWdCLEdBQUEsYUFBQSxDQUFBO0FBQUEsR0FDdEI7QUFBQSxFQVdELFlBQUEsQ0FBYSxTQUFTLEVBQUksRUFBQTtBQUV4QixJQUFBLElBQUksV0FBVyxPQUFRLENBQUEsSUFBQSxJQUFRLE9BQU8sT0FBQSxDQUFRLFNBQVMsVUFBWSxFQUFBO0FBRWpFLE1BQUEsT0FBTyxPQUFRLENBQUEsSUFBQSxDQUFLLE1BQU0sRUFBQSxFQUFJLENBQUEsQ0FBQTtBQUFBLEtBQy9CO0FBRUQsSUFBQSxPQUFPLEVBQUUsRUFBQSxDQUFBO0FBQUEsR0FDVjtBQUFBLEVBVUQsaUJBQUEsQ0FBa0IsU0FBUyxLQUFPLEVBQUE7QUFDaEMsSUFBQSxJQUFJLE1BQVMsR0FBQSxPQUFBLENBQUE7QUFDYixJQUFBLE1BQU0sUUFBUSxFQUFBLENBQUE7QUFDZCxJQUFBLG9CQUFBLENBQXFCLElBQUksQ0FBQSxDQUN0QixPQUFTLEVBQUEsQ0FDVCxNQUFPLENBQUEsQ0FBQSxHQUFBLEtBQU8sR0FBSSxDQUFBLGVBQUEsQ0FBZ0IsS0FBVyxDQUFBLEtBQUEsS0FBQSxDQUFTLENBQ3RELENBQUEsT0FBQSxDQUFRLENBQWlCLGFBQUEsS0FBQTtBQUN4QixNQUFBLGFBQUEsQ0FBYyxlQUFnQixDQUFBLEtBQUEsQ0FBQSxDQUFPLE9BQVEsQ0FBQSxDQUFDLFFBQWEsS0FBQTtBQUN6RCxRQUFBLEtBQUEsQ0FBTSxJQUFLLENBQUEsRUFBRSxhQUFlLEVBQUEsUUFBQSxFQUFVLENBQUEsQ0FBQTtBQUFBLE9BQ3ZDLENBQUEsQ0FBQTtBQUFBLEtBQ0YsQ0FBQSxDQUFBO0FBQ0gsSUFBQSxJQUFJLFVBQVUsWUFBYyxFQUFBO0FBQzFCLE1BQUEsS0FBQSxDQUFNLE9BQU8sRUFBQSxDQUFBO0FBQUEsS0FDZDtBQUVELElBQU0sS0FBQSxDQUFBLE9BQUEsQ0FBUSxDQUFDLFVBQWUsS0FBQTtBQUM1QixNQUFTLE1BQUEsR0FBQSxJQUFBLENBQUssWUFBYSxDQUFBLE1BQUEsRUFBUSxNQUFNO0FBQ3ZDLFFBQUEsT0FBTyxVQUFXLENBQUEsUUFBQSxDQUFTLFVBQVcsQ0FBQSxhQUFBLEVBQWUsSUFBSSxDQUFBLENBQUE7QUFBQSxPQUMxRCxDQUFBLENBQUE7QUFBQSxLQUNGLENBQUEsQ0FBQTtBQUNELElBQU8sT0FBQSxNQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFTRCxhQUFBLENBQWMsVUFBVSxPQUFTLEVBQUE7QUFDL0IsSUFBTSxNQUFBLE1BQUEsR0FBUyxJQUFLLENBQUEsWUFBQSxDQUFhLE9BQU8sQ0FBQSxDQUFBO0FBQ3hDLElBQUEsSUFBQSxDQUFLLGdCQUFnQixFQUFBLENBQUE7QUFDckIsSUFBVyxRQUFBLEdBQUEsUUFBQSxDQUFTLE1BQU8sQ0FBQSxNQUFBLENBQU8sUUFBUSxDQUFBLENBQUE7QUFDMUMsSUFBQSxPQUFBLEdBQVUsTUFBTyxDQUFBLE9BQUEsQ0FBQTtBQUNqQixJQUFLLElBQUEsQ0FBQSxJQUFBLEdBQU8sUUFBUyxDQUFBLE1BQUEsQ0FBTyxPQUFPLENBQUEsQ0FBQTtBQUVuQyxJQUFBLElBQUksUUFBWSxJQUFBLElBQUEsQ0FBSyxZQUFhLENBQUEsUUFBQSxDQUFTLEVBQUUsQ0FBRyxFQUFBO0FBQzlDLE1BQU8sT0FBQSxJQUFBLENBQUssb0JBQW9CLFFBQVMsQ0FBQSxDQUFBLENBQUEsRUFBSSxTQUFTLEtBQU0sQ0FBQSxDQUFDLEdBQUcsT0FBTyxDQUFBLENBQUE7QUFBQSxLQUN4RTtBQUNELElBQUEsSUFBSSxLQUFLLDZCQUE2QixRQUFTLENBQUEsQ0FBQSxDQUFBLEtBQU8sS0FBSyxnQkFBa0IsRUFBQTtBQUMzRSxNQUFJLElBQUEsUUFBQSxDQUFTLFdBQVcsQ0FBRyxFQUFBO0FBQ3pCLFFBQUEsSUFBQSxDQUFLLElBQUksRUFBQSxDQUFBO0FBQUEsT0FDVjtBQUNELE1BQU8sT0FBQSxJQUFBLENBQUssb0JBQW9CLFFBQVMsQ0FBQSxDQUFBLENBQUEsRUFBSSxFQUFJLEVBQUEsQ0FBQyxJQUFLLENBQUEsYUFBYSxDQUFDLENBQUEsQ0FBQTtBQUFBLEtBQ3RFO0FBQ0QsSUFBQSxJQUFJLEtBQUssbUJBQXFCLEVBQUE7QUFDNUIsTUFBQSxxQkFBQSxDQUFzQixNQUFNLE9BQU8sQ0FBQSxDQUFBO0FBQ25DLE1BQUEsT0FBTyxJQUFLLENBQUEsbUJBQUEsQ0FBb0IsSUFBSyxDQUFBLG1CQUFBLEVBQXFCLFVBQVUsT0FBTyxDQUFBLENBQUE7QUFBQSxLQUM1RTtBQUNELElBQUEsSUFBSSxJQUFLLENBQUEsUUFBQSxDQUFTLE1BQVUsSUFBQSxJQUFBLENBQUssSUFBSyxDQUFBLE1BQUEsS0FBVyxDQUFLLElBQUEsQ0FBQyxJQUFLLENBQUEsY0FBQSxJQUFrQixDQUFDLElBQUEsQ0FBSyxtQkFBcUIsRUFBQTtBQUV2RyxNQUFBLElBQUEsQ0FBSyxJQUFLLENBQUEsRUFBRSxLQUFPLEVBQUEsSUFBQSxFQUFNLENBQUEsQ0FBQTtBQUFBLEtBQzFCO0FBRUQsSUFBc0IscUJBQUEsQ0FBQSxJQUFBLEVBQU0sT0FBTyxPQUFPLENBQUEsQ0FBQTtBQUMxQyxJQUFBLElBQUEsQ0FBSyxnQ0FBZ0MsRUFBQSxDQUFBO0FBQ3JDLElBQUEsSUFBQSxDQUFLLDJCQUEyQixFQUFBLENBQUE7QUFHaEMsSUFBQSxNQUFNLHlCQUF5QixNQUFNO0FBQ25DLE1BQUksSUFBQSxNQUFBLENBQU8sT0FBUSxDQUFBLE1BQUEsR0FBUyxDQUFHLEVBQUE7QUFDN0IsUUFBSyxJQUFBLENBQUEsYUFBQSxDQUFjLE1BQU8sQ0FBQSxPQUFBLENBQVEsQ0FBRSxDQUFBLENBQUEsQ0FBQTtBQUFBLE9BQ3JDO0FBQUEsS0FDUCxDQUFBO0FBRUksSUFBTSxNQUFBLFlBQUEsR0FBZSxDQUFXLFFBQUEsRUFBQSxJQUFBLENBQUssSUFBSSxFQUFBLENBQUEsQ0FBQSxDQUFBO0FBQ3pDLElBQUEsSUFBSSxLQUFLLGNBQWdCLEVBQUE7QUFDdkI7QUFDQSxNQUFBLElBQUEsQ0FBSyxpQkFBaUIsRUFBQSxDQUFBO0FBRXRCLE1BQUksSUFBQSxZQUFBLENBQUE7QUFDSixNQUFlLFlBQUEsR0FBQSxJQUFBLENBQUssaUJBQWtCLENBQUEsWUFBQSxFQUFjLFdBQVcsQ0FBQSxDQUFBO0FBQy9ELE1BQWUsWUFBQSxHQUFBLElBQUEsQ0FBSyxhQUFhLFlBQWMsRUFBQSxNQUFNLEtBQUssY0FBZSxDQUFBLElBQUEsQ0FBSyxhQUFhLENBQUMsQ0FBQSxDQUFBO0FBQzVGLE1BQUEsSUFBSSxLQUFLLE1BQVEsRUFBQTtBQUNmLFFBQWUsWUFBQSxHQUFBLElBQUEsQ0FBSyxZQUFhLENBQUEsWUFBQSxFQUFjLE1BQU07QUFDbkQsVUFBQSxJQUFBLENBQUssTUFBTyxDQUFBLElBQUEsQ0FBSyxZQUFjLEVBQUEsUUFBQSxFQUFVLE9BQU8sQ0FBQSxDQUFBO0FBQUEsU0FDakQsQ0FBQSxDQUFBO0FBQUEsT0FDRjtBQUNELE1BQWUsWUFBQSxHQUFBLElBQUEsQ0FBSyxpQkFBa0IsQ0FBQSxZQUFBLEVBQWMsWUFBWSxDQUFBLENBQUE7QUFDaEUsTUFBTyxPQUFBLFlBQUEsQ0FBQTtBQUFBLEtBQ1I7QUFDRCxJQUFBLElBQUksS0FBSyxNQUFVLElBQUEsSUFBQSxDQUFLLE1BQU8sQ0FBQSxhQUFBLENBQWMsWUFBWSxDQUFHLEVBQUE7QUFDMUQ7QUFDQSxNQUFBLElBQUEsQ0FBSyxpQkFBaUIsRUFBQSxDQUFBO0FBQ3RCLE1BQUEsSUFBQSxDQUFLLE1BQU8sQ0FBQSxJQUFBLENBQUssWUFBYyxFQUFBLFFBQUEsRUFBVSxPQUFPLENBQUEsQ0FBQTtBQUFBLEtBQ3RELE1BQUEsSUFBZSxTQUFTLE1BQVEsRUFBQTtBQUMxQixNQUFJLElBQUEsSUFBQSxDQUFLLFlBQWEsQ0FBQSxHQUFHLENBQUcsRUFBQTtBQUMxQixRQUFBLE9BQU8sSUFBSyxDQUFBLG1CQUFBLENBQW9CLEdBQUssRUFBQSxRQUFBLEVBQVUsT0FBTyxDQUFBLENBQUE7QUFBQSxPQUN2RDtBQUNELE1BQUksSUFBQSxJQUFBLENBQUssYUFBYyxDQUFBLFdBQVcsQ0FBRyxFQUFBO0FBRW5DLFFBQUssSUFBQSxDQUFBLElBQUEsQ0FBSyxXQUFhLEVBQUEsUUFBQSxFQUFVLE9BQU8sQ0FBQSxDQUFBO0FBQUEsT0FDaEQsTUFBQSxJQUFpQixJQUFLLENBQUEsUUFBQSxDQUFTLE1BQVEsRUFBQTtBQUMvQixRQUFBLElBQUEsQ0FBSyxjQUFjLEVBQUEsQ0FBQTtBQUFBLE9BQ2QsTUFBQTtBQUNMO0FBQ0EsUUFBQSxJQUFBLENBQUssaUJBQWlCLEVBQUEsQ0FBQTtBQUFBLE9BQ3ZCO0FBQUEsS0FDUCxNQUFBLElBQWUsSUFBSyxDQUFBLFFBQUEsQ0FBUyxNQUFRLEVBQUE7QUFDL0I7QUFFQSxNQUFBLElBQUEsQ0FBSyxJQUFLLENBQUEsRUFBRSxLQUFPLEVBQUEsSUFBQSxFQUFNLENBQUEsQ0FBQTtBQUFBLEtBQ3BCLE1BQUE7QUFDTDtBQUNBLE1BQUEsSUFBQSxDQUFLLGlCQUFpQixFQUFBLENBQUE7QUFBQSxLQUV2QjtBQUFBLEdBQ0Y7QUFBQSxFQU9ELGFBQWEsSUFBTSxFQUFBO0FBQ2pCLElBQUEsSUFBSSxDQUFDLElBQUE7QUFBTSxNQUFPLE9BQUEsS0FBQSxDQUFBLENBQUE7QUFDbEIsSUFBTyxPQUFBLElBQUEsQ0FBSyxRQUFTLENBQUEsSUFBQSxDQUFLLENBQU8sR0FBQSxLQUFBLEdBQUEsQ0FBSSxLQUFVLEtBQUEsSUFBQSxJQUFRLEdBQUksQ0FBQSxRQUFBLENBQVMsUUFBUyxDQUFBLElBQUksQ0FBQyxDQUFBLENBQUE7QUFBQSxHQUNuRjtBQUFBLEVBVUQsWUFBWSxHQUFLLEVBQUE7QUFDZixJQUFBLE9BQU8sS0FBSyxPQUFRLENBQUEsSUFBQSxDQUFLLFlBQVUsTUFBTyxDQUFBLEVBQUEsQ0FBRyxHQUFHLENBQUMsQ0FBQSxDQUFBO0FBQUEsR0FDbEQ7QUFBQSxFQVNELGdDQUFtQyxHQUFBO0FBRWpDLElBQUEsS0FBQSxJQUFTLEdBQU0sR0FBQSxJQUFBLEVBQU0sR0FBSyxFQUFBLEdBQUEsR0FBTSxJQUFJLE1BQVEsRUFBQTtBQUMxQyxNQUFJLEdBQUEsQ0FBQSxPQUFBLENBQVEsT0FBUSxDQUFBLENBQUMsUUFBYSxLQUFBO0FBQ2hDLFFBQUksSUFBQSxRQUFBLENBQVMsYUFBYyxHQUFJLENBQUEsY0FBQSxDQUFlLFNBQVMsYUFBYSxFQUFFLE1BQU0sS0FBWSxDQUFBLEVBQUE7QUFDdEYsVUFBQSxHQUFBLENBQUksNEJBQTRCLFFBQVEsQ0FBQSxDQUFBO0FBQUEsU0FDekM7QUFBQSxPQUNGLENBQUEsQ0FBQTtBQUFBLEtBQ0Y7QUFBQSxHQUNGO0FBQUEsRUFPRCxnQ0FBbUMsR0FBQTtBQUNqQyxJQUFBLE1BQU0sd0JBQTJCLEdBQUEsSUFBQSxDQUFLLE9BQVEsQ0FBQSxNQUFBLENBQzVDLENBQUMsTUFBVyxLQUFBO0FBQ1YsTUFBTSxNQUFBLFNBQUEsR0FBWSxPQUFPO0FBQ3pCLE1BQUEsSUFBSSxJQUFLLENBQUEsY0FBQSxDQUFlLFNBQVMsQ0FBQSxLQUFNLEtBQVcsQ0FBQSxFQUFBO0FBQ2hELFFBQU8sT0FBQSxLQUFBLENBQUE7QUFBQSxPQUNSO0FBQ0QsTUFBTyxPQUFBLElBQUEsQ0FBSyxvQkFBcUIsQ0FBQSxTQUFTLENBQU0sS0FBQSxTQUFBLENBQUE7QUFBQSxLQUV4RCxDQUFBLENBQUE7QUFFSSxJQUFNLE1BQUEsc0JBQUEsR0FBeUIseUJBQXlCLE1BQ3RELENBQUEsQ0FBQyxXQUFXLE1BQU8sQ0FBQSxhQUFBLENBQWMsU0FBUyxDQUNoRCxDQUFBLENBQUE7QUFFSSxJQUF1QixzQkFBQSxDQUFBLE9BQUEsQ0FBUSxDQUFDLE1BQVcsS0FBQTtBQUN6QyxNQUFNLE1BQUEscUJBQUEsR0FBd0Isd0JBQXlCLENBQUEsSUFBQSxDQUFLLENBQUMsT0FBQSxLQUMzRCxNQUFPLENBQUEsYUFBQSxDQUFjLFFBQVMsQ0FBQSxPQUFBLENBQVEsYUFBYSxFQUFFLENBQzdELENBQUEsQ0FBQTtBQUNNLE1BQUEsSUFBSSxxQkFBdUIsRUFBQTtBQUN6QixRQUFLLElBQUEsQ0FBQSxrQkFBQSxDQUFtQixRQUFRLHFCQUFxQixDQUFBLENBQUE7QUFBQSxPQUN0RDtBQUFBLEtBQ0YsQ0FBQSxDQUFBO0FBQUEsR0FDRjtBQUFBLEVBUUQsMkJBQThCLEdBQUE7QUFFNUIsSUFBQSxLQUFBLElBQVMsR0FBTSxHQUFBLElBQUEsRUFBTSxHQUFLLEVBQUEsR0FBQSxHQUFNLElBQUksTUFBUSxFQUFBO0FBQzFDLE1BQUEsR0FBQSxDQUFJLGdDQUFnQyxFQUFBLENBQUE7QUFBQSxLQUNyQztBQUFBLEdBQ0Y7QUFBQSxFQWtCRCxhQUFhLElBQU0sRUFBQTtBQUNqQixJQUFBLE1BQU0sV0FBVyxFQUFBLENBQUE7QUFDakIsSUFBQSxNQUFNLFVBQVUsRUFBQSxDQUFBO0FBQ2hCLElBQUEsSUFBSSxJQUFPLEdBQUEsUUFBQSxDQUFBO0FBQ1gsSUFBTSxNQUFBLElBQUEsR0FBTyxLQUFLO0FBRWxCLElBQUEsU0FBQSxXQUFBLENBQXFCLEdBQUssRUFBQTtBQUN4QixNQUFBLE9BQU8sR0FBSSxDQUFBLE1BQUEsR0FBUyxDQUFLLElBQUEsR0FBQSxDQUFJLENBQU8sQ0FBQSxLQUFBLEdBQUEsQ0FBQTtBQUFBLEtBQ3JDO0FBR0QsSUFBQSxJQUFJLG9CQUF1QixHQUFBLElBQUEsQ0FBQTtBQUMzQixJQUFBLE9BQU8sS0FBSyxNQUFRLEVBQUE7QUFDbEIsTUFBTSxNQUFBLEdBQUEsR0FBTSxLQUFLO0FBR2pCLE1BQUEsSUFBSSxRQUFRLElBQU0sRUFBQTtBQUNoQixRQUFBLElBQUksSUFBUyxLQUFBLE9BQUE7QUFBUyxVQUFBLElBQUEsQ0FBSyxLQUFLLEdBQUcsQ0FBQSxDQUFBO0FBQ25DLFFBQUssSUFBQSxDQUFBLElBQUEsQ0FBSyxHQUFHLElBQUksQ0FBQSxDQUFBO0FBQ2pCLFFBQUEsTUFBQTtBQUFBLE9BQ0Q7QUFFRCxNQUFBLElBQUksb0JBQXdCLElBQUEsQ0FBQyxXQUFZLENBQUEsR0FBRyxDQUFHLEVBQUE7QUFDN0MsUUFBQSxJQUFBLENBQUssSUFBSyxDQUFBLENBQUEsT0FBQSxFQUFVLG9CQUFxQixDQUFBLElBQUEsTUFBVSxHQUFHLENBQUEsQ0FBQTtBQUN0RCxRQUFBLFNBQUE7QUFBQSxPQUNEO0FBQ0QsTUFBdUIsb0JBQUEsR0FBQSxJQUFBLENBQUE7QUFFdkIsTUFBSSxJQUFBLFdBQUEsQ0FBWSxHQUFHLENBQUcsRUFBQTtBQUNwQixRQUFNLE1BQUEsTUFBQSxHQUFTLElBQUssQ0FBQSxXQUFBLENBQVksR0FBRyxDQUFBLENBQUE7QUFFbkMsUUFBQSxJQUFJLE1BQVEsRUFBQTtBQUNWLFVBQUEsSUFBSSxPQUFPLFFBQVUsRUFBQTtBQUNuQixZQUFNLE1BQUEsS0FBQSxHQUFRLEtBQUs7QUFDbkIsWUFBQSxJQUFJLEtBQVUsS0FBQSxLQUFBLENBQUE7QUFBVyxjQUFBLElBQUEsQ0FBSyxzQkFBc0IsTUFBTSxDQUFBLENBQUE7QUFDMUQsWUFBQSxJQUFBLENBQUssSUFBSyxDQUFBLENBQUEsT0FBQSxFQUFVLE1BQU8sQ0FBQSxJQUFBLE1BQVUsS0FBSyxDQUFBLENBQUE7QUFBQSxXQUN0RCxNQUFBLElBQXFCLE9BQU8sUUFBVSxFQUFBO0FBQzFCLFlBQUEsSUFBSSxLQUFRLEdBQUEsSUFBQSxDQUFBO0FBRVosWUFBQSxJQUFJLEtBQUssTUFBUyxHQUFBLENBQUEsSUFBSyxDQUFDLFdBQVksQ0FBQSxJQUFBLENBQUssRUFBRSxDQUFHLEVBQUE7QUFDNUMsY0FBQSxLQUFBLEdBQVEsS0FBSzthQUNkO0FBQ0QsWUFBQSxJQUFBLENBQUssSUFBSyxDQUFBLENBQUEsT0FBQSxFQUFVLE1BQU8sQ0FBQSxJQUFBLE1BQVUsS0FBSyxDQUFBLENBQUE7QUFBQSxXQUNyQyxNQUFBO0FBQ0wsWUFBQSxJQUFBLENBQUssSUFBSyxDQUFBLENBQUEsT0FBQSxFQUFVLE1BQU8sQ0FBQSxJQUFBLEVBQVEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLFdBQ3BDO0FBQ0QsVUFBdUIsb0JBQUEsR0FBQSxNQUFBLENBQU8sV0FBVyxNQUFTLEdBQUEsSUFBQSxDQUFBO0FBQ2xELFVBQUEsU0FBQTtBQUFBLFNBQ0Q7QUFBQSxPQUNGO0FBR0QsTUFBSSxJQUFBLEdBQUEsQ0FBSSxTQUFTLENBQUssSUFBQSxHQUFBLENBQUksT0FBTyxHQUFPLElBQUEsR0FBQSxDQUFJLE9BQU8sR0FBSyxFQUFBO0FBQ3RELFFBQUEsTUFBTSxNQUFTLEdBQUEsSUFBQSxDQUFLLFdBQVksQ0FBQSxDQUFBLENBQUEsRUFBSSxJQUFJLENBQUksQ0FBQSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQzVDLFFBQUEsSUFBSSxNQUFRLEVBQUE7QUFDVixVQUFBLElBQUksTUFBTyxDQUFBLFFBQUEsSUFBYSxNQUFPLENBQUEsUUFBQSxJQUFZLEtBQUssNEJBQStCLEVBQUE7QUFFN0UsWUFBSyxJQUFBLENBQUEsSUFBQSxDQUFLLFVBQVUsTUFBTyxDQUFBLElBQUEsTUFBVSxHQUFJLENBQUEsS0FBQSxDQUFNLENBQUMsQ0FBQyxDQUFBLENBQUE7QUFBQSxXQUM1QyxNQUFBO0FBRUwsWUFBQSxJQUFBLENBQUssSUFBSyxDQUFBLENBQUEsT0FBQSxFQUFVLE1BQU8sQ0FBQSxJQUFBLEVBQVEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUNuQyxZQUFBLElBQUEsQ0FBSyxPQUFRLENBQUEsQ0FBQSxDQUFBLEVBQUksR0FBSSxDQUFBLEtBQUEsQ0FBTSxDQUFDLENBQUcsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLFdBQ2hDO0FBQ0QsVUFBQSxTQUFBO0FBQUEsU0FDRDtBQUFBLE9BQ0Y7QUFHRCxNQUFJLElBQUEsV0FBQSxDQUFZLElBQUssQ0FBQSxHQUFHLENBQUcsRUFBQTtBQUN6QixRQUFNLE1BQUEsS0FBQSxHQUFRLEdBQUksQ0FBQSxPQUFBLENBQVEsR0FBRyxDQUFBLENBQUE7QUFDN0IsUUFBQSxNQUFNLFNBQVMsSUFBSyxDQUFBLFdBQUEsQ0FBWSxJQUFJLEtBQU0sQ0FBQSxDQUFBLEVBQUcsS0FBSyxDQUFDLENBQUEsQ0FBQTtBQUNuRCxRQUFBLElBQUksTUFBVyxLQUFBLE1BQUEsQ0FBTyxRQUFZLElBQUEsTUFBQSxDQUFPLFFBQVcsQ0FBQSxFQUFBO0FBQ2xELFVBQUssSUFBQSxDQUFBLElBQUEsQ0FBSyxVQUFVLE1BQU8sQ0FBQSxJQUFBLE1BQVUsR0FBSSxDQUFBLEtBQUEsQ0FBTSxLQUFRLEdBQUEsQ0FBQyxDQUFDLENBQUEsQ0FBQTtBQUN6RCxVQUFBLFNBQUE7QUFBQSxTQUNEO0FBQUEsT0FDRjtBQU1ELE1BQUksSUFBQSxXQUFBLENBQVksR0FBRyxDQUFHLEVBQUE7QUFDcEIsUUFBTyxJQUFBLEdBQUEsT0FBQSxDQUFBO0FBQUEsT0FDUjtBQUdELE1BQUssSUFBQSxDQUFBLElBQUEsQ0FBSyw0QkFBNEIsSUFBSyxDQUFBLG1CQUFBLEtBQXdCLFNBQVMsTUFBVyxLQUFBLENBQUEsSUFBSyxPQUFRLENBQUEsTUFBQSxLQUFXLENBQUcsRUFBQTtBQUNoSCxRQUFJLElBQUEsSUFBQSxDQUFLLFlBQWEsQ0FBQSxHQUFHLENBQUcsRUFBQTtBQUMxQixVQUFBLFFBQUEsQ0FBUyxLQUFLLEdBQUcsQ0FBQSxDQUFBO0FBQ2pCLFVBQUEsSUFBSSxLQUFLLE1BQVMsR0FBQSxDQUFBO0FBQUcsWUFBUSxPQUFBLENBQUEsSUFBQSxDQUFLLEdBQUcsSUFBSSxDQUFBLENBQUE7QUFDekMsVUFBQSxNQUFBO0FBQUEsbUJBQ1MsR0FBUSxLQUFBLElBQUEsQ0FBSyxnQkFBb0IsSUFBQSxJQUFBLENBQUsseUJBQTJCLEVBQUE7QUFDMUUsVUFBQSxRQUFBLENBQVMsS0FBSyxHQUFHLENBQUEsQ0FBQTtBQUNqQixVQUFBLElBQUksS0FBSyxNQUFTLEdBQUEsQ0FBQTtBQUFHLFlBQVMsUUFBQSxDQUFBLElBQUEsQ0FBSyxHQUFHLElBQUksQ0FBQSxDQUFBO0FBQzFDLFVBQUEsTUFBQTtBQUFBLFNBQ1YsTUFBQSxJQUFtQixLQUFLLG1CQUFxQixFQUFBO0FBQ25DLFVBQUEsT0FBQSxDQUFRLEtBQUssR0FBRyxDQUFBLENBQUE7QUFDaEIsVUFBQSxJQUFJLEtBQUssTUFBUyxHQUFBLENBQUE7QUFBRyxZQUFRLE9BQUEsQ0FBQSxJQUFBLENBQUssR0FBRyxJQUFJLENBQUEsQ0FBQTtBQUN6QyxVQUFBLE1BQUE7QUFBQSxTQUNEO0FBQUEsT0FDRjtBQUdELE1BQUEsSUFBSSxLQUFLLG1CQUFxQixFQUFBO0FBQzVCLFFBQUEsSUFBQSxDQUFLLEtBQUssR0FBRyxDQUFBLENBQUE7QUFDYixRQUFBLElBQUksS0FBSyxNQUFTLEdBQUEsQ0FBQTtBQUFHLFVBQUssSUFBQSxDQUFBLElBQUEsQ0FBSyxHQUFHLElBQUksQ0FBQSxDQUFBO0FBQ3RDLFFBQUEsTUFBQTtBQUFBLE9BQ0Q7QUFHRCxNQUFBLElBQUEsQ0FBSyxLQUFLLEdBQUcsQ0FBQSxDQUFBO0FBQUEsS0FDZDtBQUVELElBQU8sT0FBQSxFQUFFLFVBQVU7R0FDcEI7QUFBQSxFQU9ELElBQU8sR0FBQTtBQUNMLElBQUEsSUFBSSxLQUFLLHlCQUEyQixFQUFBO0FBRWxDLE1BQUEsTUFBTSxTQUFTLEVBQUEsQ0FBQTtBQUNmLE1BQU0sTUFBQSxHQUFBLEdBQU0sS0FBSyxPQUFRLENBQUEsTUFBQSxDQUFBO0FBRXpCLE1BQUEsS0FBQSxJQUFTLENBQUksR0FBQSxDQUFBLEVBQUcsQ0FBSSxHQUFBLEdBQUEsRUFBSyxDQUFLLEVBQUEsRUFBQTtBQUM1QixRQUFBLE1BQU0sR0FBTSxHQUFBLElBQUEsQ0FBSyxPQUFRLENBQUEsQ0FBQSxDQUFBLENBQUcsYUFBYSxFQUFBLENBQUE7QUFDekMsUUFBQSxNQUFBLENBQU8sT0FBTyxHQUFRLEtBQUEsSUFBQSxDQUFLLGtCQUFxQixHQUFBLElBQUEsQ0FBSyxXQUFXLElBQUssQ0FBQSxHQUFBLENBQUEsQ0FBQTtBQUFBLE9BQ3RFO0FBQ0QsTUFBTyxPQUFBLE1BQUEsQ0FBQTtBQUFBLEtBQ1I7QUFFRCxJQUFBLE9BQU8sSUFBSyxDQUFBLGFBQUEsQ0FBQTtBQUFBLEdBQ2I7QUFBQSxFQU9ELGVBQWtCLEdBQUE7QUFFaEIsSUFBQSxPQUFPLG9CQUFxQixDQUFBLElBQUksQ0FBRSxDQUFBLE1BQUEsQ0FDaEMsQ0FBQyxlQUFpQixFQUFBLEdBQUEsS0FBUSxNQUFPLENBQUEsTUFBQSxDQUFPLGlCQUFpQixHQUFJLENBQUEsSUFBQSxFQUFNLENBQUEsRUFDbkUsRUFDTixDQUFBLENBQUE7QUFBQSxHQUNHO0FBQUEsRUFVRCxLQUFBLENBQU0sU0FBUyxZQUFjLEVBQUE7QUFFM0IsSUFBSyxJQUFBLENBQUEsb0JBQUEsQ0FBcUIsWUFBWSxDQUFHLEVBQUEsT0FBQSxDQUFBO0FBQUEsQ0FBYSxFQUFBLElBQUEsQ0FBSyxxQkFBcUIsUUFBUSxDQUFBLENBQUE7QUFDeEYsSUFBSSxJQUFBLE9BQU8sSUFBSyxDQUFBLG1CQUFBLEtBQXdCLFFBQVUsRUFBQTtBQUNoRCxNQUFLLElBQUEsQ0FBQSxvQkFBQSxDQUFxQixRQUFTLENBQUEsQ0FBQSxFQUFHLElBQUssQ0FBQSxtQkFBQSxDQUFBO0FBQUEsQ0FBdUIsQ0FBQSxDQUFBO0FBQUEsS0FDeEUsTUFBQSxJQUFlLEtBQUssbUJBQXFCLEVBQUE7QUFDbkMsTUFBSyxJQUFBLENBQUEsb0JBQUEsQ0FBcUIsU0FBUyxJQUFJLENBQUEsQ0FBQTtBQUN2QyxNQUFBLElBQUEsQ0FBSyxVQUFXLENBQUEsRUFBRSxLQUFPLEVBQUEsSUFBQSxFQUFNLENBQUEsQ0FBQTtBQUFBLEtBQ2hDO0FBR0QsSUFBTSxNQUFBLE1BQUEsR0FBUyxnQkFBZ0I7QUFDL0IsSUFBTSxNQUFBLFFBQUEsR0FBVyxPQUFPLFFBQVksSUFBQSxDQUFBLENBQUE7QUFDcEMsSUFBTSxNQUFBLElBQUEsR0FBTyxPQUFPLElBQVEsSUFBQSxpQkFBQSxDQUFBO0FBQzVCLElBQUssSUFBQSxDQUFBLEtBQUEsQ0FBTSxRQUFVLEVBQUEsSUFBQSxFQUFNLE9BQU8sQ0FBQSxDQUFBO0FBQUEsR0FDbkM7QUFBQSxFQVFELGdCQUFtQixHQUFBO0FBQ2pCLElBQUssSUFBQSxDQUFBLE9BQUEsQ0FBUSxPQUFRLENBQUEsQ0FBQyxNQUFXLEtBQUE7QUFDL0IsTUFBQSxJQUFJLE1BQU8sQ0FBQSxNQUFBLElBQVUsTUFBTyxDQUFBLE1BQUEsSUFBVVUsVUFBUSxHQUFLLEVBQUE7QUFDakQsUUFBTSxNQUFBLFNBQUEsR0FBWSxPQUFPO0FBRXpCLFFBQUEsSUFBSSxJQUFLLENBQUEsY0FBQSxDQUFlLFNBQVMsQ0FBQSxLQUFNLFVBQWEsQ0FBQyxTQUFBLEVBQVcsUUFBVSxFQUFBLEtBQUssRUFBRSxRQUFTLENBQUEsSUFBQSxDQUFLLG9CQUFxQixDQUFBLFNBQVMsQ0FBQyxDQUFHLEVBQUE7QUFDL0gsVUFBSSxJQUFBLE1BQUEsQ0FBTyxRQUFZLElBQUEsTUFBQSxDQUFPLFFBQVUsRUFBQTtBQUV0QyxZQUFLLElBQUEsQ0FBQSxJQUFBLENBQUssYUFBYSxNQUFPLENBQUEsSUFBQSxNQUFVQSxTQUFRLENBQUEsR0FBQSxDQUFJLE9BQU8sTUFBTyxDQUFBLENBQUEsQ0FBQTtBQUFBLFdBQzdELE1BQUE7QUFFTCxZQUFBLElBQUEsQ0FBSyxJQUFLLENBQUEsQ0FBQSxVQUFBLEVBQWEsTUFBTyxDQUFBLElBQUEsRUFBUSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQUEsV0FDdkM7QUFBQSxTQUNGO0FBQUEsT0FDRjtBQUFBLEtBQ0YsQ0FBQSxDQUFBO0FBQUEsR0FDRjtBQUFBLEVBU0QsZ0JBQWdCLElBQU0sRUFBQTtBQUNwQixJQUFBLE1BQU0sVUFBVSxDQUFxQyxrQ0FBQSxFQUFBLElBQUEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUNyRCxJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsT0FBQSxFQUFTLEVBQUUsSUFBQSxFQUFNLDZCQUE2QixDQUFBLENBQUE7QUFBQSxHQUMxRDtBQUFBLEVBU0Qsc0JBQXNCLE1BQVEsRUFBQTtBQUM1QixJQUFNLE1BQUEsT0FBQSxHQUFVLGtCQUFrQixNQUFPLENBQUEsS0FBQSxDQUFBLGtCQUFBLENBQUEsQ0FBQTtBQUN6QyxJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsT0FBQSxFQUFTLEVBQUUsSUFBQSxFQUFNLG1DQUFtQyxDQUFBLENBQUE7QUFBQSxHQUNoRTtBQUFBLEVBU0QsNEJBQTRCLE1BQVEsRUFBQTtBQUNsQyxJQUFNLE1BQUEsT0FBQSxHQUFVLDJCQUEyQixNQUFPLENBQUEsS0FBQSxDQUFBLGVBQUEsQ0FBQSxDQUFBO0FBQ2xELElBQUEsSUFBQSxDQUFLLEtBQU0sQ0FBQSxPQUFBLEVBQVMsRUFBRSxJQUFBLEVBQU0seUNBQXlDLENBQUEsQ0FBQTtBQUFBLEdBQ3RFO0FBQUEsRUFTRCxrQkFBQSxDQUFtQixRQUFRLGlCQUFtQixFQUFBO0FBRzVDLElBQU0sTUFBQSx1QkFBQSxHQUEwQixDQUFDLE9BQVcsS0FBQTtBQUMxQyxNQUFNLE1BQUEsU0FBQSxHQUFZLFFBQU87QUFDekIsTUFBTSxNQUFBLFdBQUEsR0FBYyxJQUFLLENBQUEsY0FBQSxDQUFlLFNBQVMsQ0FBQSxDQUFBO0FBQ2pELE1BQU0sTUFBQSxjQUFBLEdBQWlCLElBQUssQ0FBQSxPQUFBLENBQVEsSUFBSyxDQUFBLENBQUEsTUFBQSxLQUFVLE9BQU8sTUFBVSxJQUFBLFNBQUEsS0FBYyxNQUFPLENBQUEsYUFBQSxFQUFlLENBQUEsQ0FBQTtBQUN4RyxNQUFNLE1BQUEsY0FBQSxHQUFpQixJQUFLLENBQUEsT0FBQSxDQUFRLElBQUssQ0FBQSxDQUFBLE1BQUEsS0FBVSxDQUFDLE1BQUEsQ0FBTyxNQUFVLElBQUEsU0FBQSxLQUFjLE1BQU8sQ0FBQSxhQUFBLEVBQWUsQ0FBQSxDQUFBO0FBQ3pHLE1BQUksSUFBQSxjQUFBLEtBQ2MsY0FBQSxDQUFBLFNBQUEsS0FBYyxLQUFhLENBQUEsSUFBQSxXQUFBLEtBQWdCLEtBQzFELElBQUEsY0FBQSxDQUFlLFNBQWMsS0FBQSxLQUFBLENBQUEsSUFBYSxXQUFnQixLQUFBLGNBQUEsQ0FBZSxTQUN6RSxDQUFBLEVBQUE7QUFDRCxRQUFPLE9BQUEsY0FBQSxDQUFBO0FBQUEsT0FDUjtBQUNELE1BQUEsT0FBTyxjQUFrQixJQUFBLE9BQUEsQ0FBQTtBQUFBLEtBQy9CLENBQUE7QUFFSSxJQUFNLE1BQUEsZUFBQSxHQUFrQixDQUFDLE9BQVcsS0FBQTtBQUNsQyxNQUFNLE1BQUEsVUFBQSxHQUFhLHdCQUF3QixPQUFNLENBQUEsQ0FBQTtBQUNqRCxNQUFNLE1BQUEsU0FBQSxHQUFZLFdBQVc7QUFDN0IsTUFBTSxNQUFBLE1BQUEsR0FBUyxJQUFLLENBQUEsb0JBQUEsQ0FBcUIsU0FBUyxDQUFBLENBQUE7QUFDbEQsTUFBQSxJQUFJLFdBQVcsS0FBTyxFQUFBO0FBQ3BCLFFBQUEsT0FBTyx5QkFBeUIsVUFBVyxDQUFBLE1BQUEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLE9BQzVDO0FBQ0QsTUFBQSxPQUFPLFdBQVcsVUFBVyxDQUFBLEtBQUEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLEtBQ25DLENBQUE7QUFFSSxJQUFBLE1BQU0sVUFBVSxDQUFVLE9BQUEsRUFBQSxlQUFBLENBQWdCLE1BQU0sQ0FBQSxDQUFBLHFCQUFBLEVBQXlCLGdCQUFnQixpQkFBaUIsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUMxRyxJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsT0FBQSxFQUFTLEVBQUUsSUFBQSxFQUFNLCtCQUErQixDQUFBLENBQUE7QUFBQSxHQUM1RDtBQUFBLEVBU0QsY0FBYyxJQUFNLEVBQUE7QUFDbEIsSUFBQSxJQUFJLElBQUssQ0FBQSxtQkFBQTtBQUFxQixNQUFBLE9BQUE7QUFDOUIsSUFBQSxJQUFJLFVBQWEsR0FBQSxFQUFBLENBQUE7QUFFakIsSUFBQSxJQUFJLElBQUssQ0FBQSxVQUFBLENBQVcsSUFBSSxDQUFBLElBQUssS0FBSyx5QkFBMkIsRUFBQTtBQUUzRCxNQUFBLElBQUksaUJBQWlCLEVBQUEsQ0FBQTtBQUNyQixNQUFBLElBQUksUUFBVSxHQUFBLElBQUEsQ0FBQTtBQUNkLE1BQUcsR0FBQTtBQUNELFFBQUEsTUFBTSxTQUFZLEdBQUEsUUFBQSxDQUFRLFVBQVUsRUFBQSxDQUFHLGVBQWUsUUFBTyxDQUFBLENBQzFELE1BQU8sQ0FBQSxDQUFBLE1BQUEsS0FBVSxPQUFPLElBQUksQ0FBQSxDQUM1QixHQUFJLENBQUEsQ0FBQSxNQUFBLEtBQVUsT0FBTyxJQUFJLENBQUEsQ0FBQTtBQUM1QixRQUFpQixjQUFBLEdBQUEsY0FBQSxDQUFlLE9BQU8sU0FBUyxDQUFBLENBQUE7QUFDaEQsUUFBQSxRQUFBLEdBQVUsUUFBUSxDQUFBLE1BQUEsQ0FBQTtBQUFBLE9BQzFCLFFBQWUsUUFBVyxJQUFBLENBQUMsUUFBUSxDQUFBLHdCQUFBLEVBQUE7QUFDN0IsTUFBYSxVQUFBLEdBQUEsY0FBQSxDQUFlLE1BQU0sY0FBYyxDQUFBLENBQUE7QUFBQSxLQUNqRDtBQUVELElBQU0sTUFBQSxPQUFBLEdBQVUsMEJBQTBCLElBQVEsQ0FBQSxDQUFBLEVBQUEsVUFBQSxDQUFBLENBQUEsQ0FBQTtBQUNsRCxJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsT0FBQSxFQUFTLEVBQUUsSUFBQSxFQUFNLDJCQUEyQixDQUFBLENBQUE7QUFBQSxHQUN4RDtBQUFBLEVBU0QsaUJBQWlCLFlBQWMsRUFBQTtBQUM3QixJQUFBLElBQUksSUFBSyxDQUFBLHFCQUFBO0FBQXVCLE1BQUEsT0FBQTtBQUVoQyxJQUFNLE1BQUEsUUFBQSxHQUFXLEtBQUssS0FBTSxDQUFBLE1BQUEsQ0FBQTtBQUM1QixJQUFNLE1BQUEsQ0FBQSxHQUFLLFFBQWEsS0FBQSxDQUFBLEdBQUssRUFBSyxHQUFBLEdBQUEsQ0FBQTtBQUNsQyxJQUFBLE1BQU0sZ0JBQWdCLElBQUssQ0FBQSxNQUFBLEdBQVMsQ0FBUyxNQUFBLEVBQUEsSUFBQSxDQUFLLE1BQVksQ0FBQSxDQUFBLENBQUEsR0FBQSxFQUFBLENBQUE7QUFDOUQsSUFBQSxNQUFNLE9BQVUsR0FBQSxDQUFBLHlCQUFBLEVBQTRCLGFBQTJCLENBQUEsV0FBQSxFQUFBLFFBQUEsQ0FBQSxTQUFBLEVBQW9CLGFBQWEsWUFBYSxDQUFBLE1BQUEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUNySCxJQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsT0FBQSxFQUFTLEVBQUUsSUFBQSxFQUFNLDZCQUE2QixDQUFBLENBQUE7QUFBQSxHQUMxRDtBQUFBLEVBUUQsY0FBaUIsR0FBQTtBQUNmLElBQU0sTUFBQSxXQUFBLEdBQWMsS0FBSyxJQUFLLENBQUEsQ0FBQSxDQUFBLENBQUE7QUFDOUIsSUFBQSxJQUFJLFVBQWEsR0FBQSxFQUFBLENBQUE7QUFFakIsSUFBQSxJQUFJLEtBQUsseUJBQTJCLEVBQUE7QUFDbEMsTUFBQSxNQUFNLGlCQUFpQixFQUFBLENBQUE7QUFDdkIsTUFBQSxJQUFBLENBQUssWUFBYSxDQUFBLGVBQUEsQ0FBZ0IsSUFBSSxDQUFFLENBQUEsT0FBQSxDQUFRLENBQUMsUUFBWSxLQUFBO0FBQzNELFFBQWUsY0FBQSxDQUFBLElBQUEsQ0FBSyxRQUFRLENBQUEsSUFBQSxFQUFNLENBQUEsQ0FBQTtBQUVsQyxRQUFBLElBQUksU0FBUTtBQUFTLFVBQWUsY0FBQSxDQUFBLElBQUEsQ0FBSyxRQUFRLENBQUEsS0FBQSxFQUFPLENBQUEsQ0FBQTtBQUFBLE9BQ3pELENBQUEsQ0FBQTtBQUNELE1BQWEsVUFBQSxHQUFBLGNBQUEsQ0FBZSxhQUFhLGNBQWMsQ0FBQSxDQUFBO0FBQUEsS0FDeEQ7QUFFRCxJQUFNLE1BQUEsT0FBQSxHQUFVLDJCQUEyQixXQUFlLENBQUEsQ0FBQSxFQUFBLFVBQUEsQ0FBQSxDQUFBLENBQUE7QUFDMUQsSUFBQSxJQUFBLENBQUssS0FBTSxDQUFBLE9BQUEsRUFBUyxFQUFFLElBQUEsRUFBTSw0QkFBNEIsQ0FBQSxDQUFBO0FBQUEsR0FDekQ7QUFBQSxFQWdCRCxPQUFBLENBQVEsR0FBSyxFQUFBLEtBQUEsRUFBTyxXQUFhLEVBQUE7QUFDL0IsSUFBQSxJQUFJLEdBQVEsS0FBQSxLQUFBLENBQUE7QUFBVyxNQUFBLE9BQU8sSUFBSyxDQUFBLFFBQUEsQ0FBQTtBQUNuQyxJQUFBLElBQUEsQ0FBSyxRQUFXLEdBQUEsR0FBQSxDQUFBO0FBQ2hCLElBQUEsS0FBQSxHQUFRLEtBQVMsSUFBQSxlQUFBLENBQUE7QUFDakIsSUFBQSxXQUFBLEdBQWMsV0FBZSxJQUFBLDJCQUFBLENBQUE7QUFDN0IsSUFBQSxNQUFNLGFBQWdCLEdBQUEsSUFBQSxDQUFLLFlBQWEsQ0FBQSxLQUFBLEVBQU8sV0FBVyxDQUFBLENBQUE7QUFDMUQsSUFBSyxJQUFBLENBQUEsa0JBQUEsR0FBcUIsY0FBYztBQUN4QyxJQUFLLElBQUEsQ0FBQSxPQUFBLENBQVEsS0FBSyxhQUFhLENBQUEsQ0FBQTtBQUMvQixJQUFBLElBQUEsQ0FBSyxFQUFHLENBQUEsU0FBQSxHQUFZLGFBQWMsQ0FBQSxJQUFBLElBQVEsTUFBTTtBQUM5QyxNQUFLLElBQUEsQ0FBQSxvQkFBQSxDQUFxQixTQUFTLENBQUcsRUFBQSxHQUFBLENBQUE7QUFBQSxDQUFPLENBQUEsQ0FBQTtBQUM3QyxNQUFLLElBQUEsQ0FBQSxLQUFBLENBQU0sQ0FBRyxFQUFBLG1CQUFBLEVBQXFCLEdBQUcsQ0FBQSxDQUFBO0FBQUEsS0FDdkMsQ0FBQSxDQUFBO0FBQ0QsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVNELFdBQUEsQ0FBWSxLQUFLLGVBQWlCLEVBQUE7QUFDaEMsSUFBSSxJQUFBLEdBQUEsS0FBUSxVQUFhLGVBQW9CLEtBQUEsS0FBQSxDQUFBO0FBQVcsTUFBQSxPQUFPLElBQUssQ0FBQSxZQUFBLENBQUE7QUFDcEUsSUFBQSxJQUFBLENBQUssWUFBZSxHQUFBLEdBQUEsQ0FBQTtBQUNwQixJQUFBLElBQUksZUFBaUIsRUFBQTtBQUNuQixNQUFBLElBQUEsQ0FBSyxnQkFBbUIsR0FBQSxlQUFBLENBQUE7QUFBQSxLQUN6QjtBQUNELElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFXRCxNQUFNLEtBQU8sRUFBQTtBQUNYLElBQUEsSUFBSSxLQUFVLEtBQUEsS0FBQSxDQUFBO0FBQVcsTUFBQSxPQUFPLEtBQUssUUFBUyxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBRzlDLElBQUEsSUFBSSxRQUFVLEdBQUEsSUFBQSxDQUFBO0FBQ2QsSUFBSSxJQUFBLElBQUEsQ0FBSyxRQUFTLENBQUEsTUFBQSxLQUFXLENBQUssSUFBQSxJQUFBLENBQUssU0FBUyxJQUFLLENBQUEsUUFBQSxDQUFTLE1BQVMsR0FBQSxDQUFBLENBQUEsQ0FBRyxrQkFBb0IsRUFBQTtBQUU1RixNQUFBLFFBQUEsR0FBVSxJQUFLLENBQUEsUUFBQSxDQUFTLElBQUssQ0FBQSxRQUFBLENBQVMsTUFBUyxHQUFBLENBQUEsQ0FBQSxDQUFBO0FBQUEsS0FDaEQ7QUFFRCxJQUFBLElBQUksVUFBVSxRQUFRLENBQUEsS0FBQTtBQUFPLE1BQU0sTUFBQSxJQUFJLE1BQU0sNkNBQThDLENBQUEsQ0FBQTtBQUUzRixJQUFRLFFBQUEsQ0FBQSxRQUFBLENBQVMsS0FBSyxLQUFLLENBQUEsQ0FBQTtBQUMzQixJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBV0QsUUFBUSxPQUFTLEVBQUE7QUFFZixJQUFBLElBQUksT0FBWSxLQUFBLEtBQUEsQ0FBQTtBQUFXLE1BQUEsT0FBTyxJQUFLLENBQUEsUUFBQSxDQUFBO0FBRXZDLElBQUEsT0FBQSxDQUFRLFFBQVEsQ0FBQyxLQUFBLEtBQVUsSUFBSyxDQUFBLEtBQUEsQ0FBTSxLQUFLLENBQUMsQ0FBQSxDQUFBO0FBQzVDLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFTRCxNQUFNLEdBQUssRUFBQTtBQUNULElBQUEsSUFBSSxRQUFRLEtBQVcsQ0FBQSxFQUFBO0FBQ3JCLE1BQUEsSUFBSSxJQUFLLENBQUEsTUFBQTtBQUFRLFFBQUEsT0FBTyxJQUFLLENBQUEsTUFBQSxDQUFBO0FBRTdCLE1BQUEsTUFBTSxJQUFPLEdBQUEsSUFBQSxDQUFLLEtBQU0sQ0FBQSxHQUFBLENBQUksQ0FBQyxHQUFRLEtBQUE7QUFDbkMsUUFBQSxPQUFPLHFCQUFxQixHQUFHLENBQUEsQ0FBQTtBQUFBLE9BQ2hDLENBQUEsQ0FBQTtBQUNELE1BQU8sT0FBQSxFQUFHLENBQUEsTUFBQSxDQUNQLElBQUssQ0FBQSxPQUFBLENBQVEsVUFBVSxJQUFLLENBQUEsY0FBQSxHQUFpQixXQUFjLEdBQUEsRUFDM0QsRUFBQSxJQUFBLENBQUssU0FBUyxNQUFTLEdBQUEsV0FBQSxHQUFjLEVBQUUsRUFDdkMsSUFBSyxDQUFBLEtBQUEsQ0FBTSxNQUFTLEdBQUEsSUFBQSxHQUFPLEVBQ3BDLENBQVEsQ0FBQSxJQUFBLENBQUssR0FBRyxDQUFBLENBQUE7QUFBQSxLQUNYO0FBRUQsSUFBQSxJQUFBLENBQUssTUFBUyxHQUFBLEdBQUEsQ0FBQTtBQUNkLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFTRCxLQUFLLEdBQUssRUFBQTtBQUNSLElBQUEsSUFBSSxHQUFRLEtBQUEsS0FBQSxDQUFBO0FBQVcsTUFBQSxPQUFPLElBQUssQ0FBQSxLQUFBLENBQUE7QUFDbkMsSUFBQSxJQUFBLENBQUssS0FBUSxHQUFBLEdBQUEsQ0FBQTtBQUNiLElBQU8sT0FBQSxJQUFBLENBQUE7QUFBQSxHQUNSO0FBQUEsRUFlRCxpQkFBaUIsUUFBVSxFQUFBO0FBQ3pCLElBQUEsSUFBQSxDQUFLLFFBQVEsSUFBSyxDQUFBLFFBQUEsQ0FBUyxVQUFVLElBQUssQ0FBQSxPQUFBLENBQVEsUUFBUSxDQUFDLENBQUEsQ0FBQTtBQUUzRCxJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBY0QsY0FBYyxLQUFNLEVBQUE7QUFDbEIsSUFBQSxJQUFJLEtBQVMsS0FBQSxLQUFBLENBQUE7QUFBVyxNQUFBLE9BQU8sSUFBSyxDQUFBLGNBQUEsQ0FBQTtBQUNwQyxJQUFBLElBQUEsQ0FBSyxjQUFpQixHQUFBLEtBQUEsQ0FBQTtBQUN0QixJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUFBLEVBU0QsZ0JBQWdCLGNBQWdCLEVBQUE7QUFDOUIsSUFBTSxNQUFBLE1BQUEsR0FBUyxLQUFLO0FBQ3BCLElBQUksSUFBQSxNQUFBLENBQU8sY0FBYyxLQUFXLENBQUEsRUFBQTtBQUNsQyxNQUFPLE1BQUEsQ0FBQSxTQUFBLEdBQWEsY0FBa0IsSUFBQSxjQUFBLENBQWUsS0FBUyxHQUFBLElBQUEsQ0FBSyxxQkFBcUIsZUFBZSxFQUFBLEdBQUssSUFBSyxDQUFBLG9CQUFBLENBQXFCLGVBQWUsRUFBQSxDQUFBO0FBQUEsS0FDdEo7QUFDRCxJQUFPLE9BQUEsTUFBQSxDQUFPLFVBQVcsQ0FBQSxJQUFBLEVBQU0sTUFBTSxDQUFBLENBQUE7QUFBQSxHQUN0QztBQUFBLEVBTUQsZ0JBQWdCLGNBQWdCLEVBQUE7QUFDOUIsSUFBQSxjQUFBLEdBQWlCLGtCQUFrQjtBQUNuQyxJQUFBLE1BQU0sVUFBVSxFQUFFLEtBQUEsRUFBTyxDQUFDLENBQUMsZUFBZSxLQUFLLEVBQUEsQ0FBQTtBQUMvQyxJQUFJLElBQUEsS0FBQSxDQUFBO0FBQ0osSUFBQSxJQUFJLFFBQVEsS0FBTyxFQUFBO0FBQ2pCLE1BQUEsS0FBQSxHQUFRLENBQUMsR0FBQSxLQUFRLElBQUssQ0FBQSxvQkFBQSxDQUFxQixTQUFTLEdBQUcsQ0FBQSxDQUFBO0FBQUEsS0FDbEQsTUFBQTtBQUNMLE1BQUEsS0FBQSxHQUFRLENBQUMsR0FBQSxLQUFRLElBQUssQ0FBQSxvQkFBQSxDQUFxQixTQUFTLEdBQUcsQ0FBQSxDQUFBO0FBQUEsS0FDeEQ7QUFDRCxJQUFRLE9BQUEsQ0FBQSxLQUFBLEdBQVEsZUFBZSxLQUFTLElBQUEsS0FBQSxDQUFBO0FBQ3hDLElBQUEsT0FBQSxDQUFRLE9BQVUsR0FBQSxJQUFBLENBQUE7QUFDbEIsSUFBTyxPQUFBLE9BQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVVELFdBQVcsY0FBZ0IsRUFBQTtBQUN6QixJQUFJLElBQUEsa0JBQUEsQ0FBQTtBQUNKLElBQUksSUFBQSxPQUFPLG1CQUFtQixVQUFZLEVBQUE7QUFDeEMsTUFBcUIsa0JBQUEsR0FBQSxjQUFBLENBQUE7QUFDckIsTUFBaUIsY0FBQSxHQUFBLEtBQUEsQ0FBQSxDQUFBO0FBQUEsS0FDbEI7QUFDRCxJQUFNLE1BQUEsT0FBQSxHQUFVLElBQUssQ0FBQSxlQUFBLENBQWdCLGNBQWMsQ0FBQSxDQUFBO0FBRW5ELElBQXFCLG9CQUFBLENBQUEsSUFBSSxDQUFFLENBQUEsT0FBQSxFQUFVLENBQUEsT0FBQSxDQUFRLGNBQVcsUUFBUSxDQUFBLElBQUEsQ0FBSyxlQUFpQixFQUFBLE9BQU8sQ0FBQyxDQUFBLENBQUE7QUFDOUYsSUFBSyxJQUFBLENBQUEsSUFBQSxDQUFLLGNBQWMsT0FBTyxDQUFBLENBQUE7QUFFL0IsSUFBSSxJQUFBLGVBQUEsR0FBa0IsSUFBSyxDQUFBLGVBQUEsQ0FBZ0IsT0FBTyxDQUFBLENBQUE7QUFDbEQsSUFBQSxJQUFJLGtCQUFvQixFQUFBO0FBQ3RCLE1BQUEsZUFBQSxHQUFrQixtQkFBbUIsZUFBZSxDQUFBLENBQUE7QUFDcEQsTUFBQSxJQUFJLE9BQU8sZUFBb0IsS0FBQSxRQUFBLElBQVksQ0FBQyxNQUFPLENBQUEsUUFBQSxDQUFTLGVBQWUsQ0FBRyxFQUFBO0FBQzVFLFFBQU0sTUFBQSxJQUFJLE1BQU0sc0RBQXNELENBQUEsQ0FBQTtBQUFBLE9BQ3ZFO0FBQUEsS0FDRjtBQUNELElBQUEsT0FBQSxDQUFRLE1BQU0sZUFBZSxDQUFBLENBQUE7QUFFN0IsSUFBSyxJQUFBLENBQUEsSUFBQSxDQUFLLEtBQUssYUFBYSxDQUFBLENBQUE7QUFDNUIsSUFBSyxJQUFBLENBQUEsSUFBQSxDQUFLLGFBQWEsT0FBTyxDQUFBLENBQUE7QUFDOUIsSUFBcUIsb0JBQUEsQ0FBQSxJQUFJLEVBQUUsT0FBUSxDQUFBLENBQUEsUUFBQSxLQUFXLFNBQVEsSUFBSyxDQUFBLGNBQUEsRUFBZ0IsT0FBTyxDQUFDLENBQUEsQ0FBQTtBQUFBLEdBQ3BGO0FBQUEsRUFZRCxVQUFBLENBQVcsT0FBTyxXQUFhLEVBQUE7QUFDN0IsSUFBSSxJQUFBLE9BQU8sVUFBVSxTQUFXLEVBQUE7QUFDOUIsTUFBQSxJQUFBLENBQUssY0FBaUIsR0FBQSxLQUFBLENBQUE7QUFDdEIsTUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEtBQ1I7QUFDRCxJQUFLLElBQUEsQ0FBQSxVQUFBLEdBQWEsU0FBUyxJQUFLLENBQUEsVUFBQSxDQUFBO0FBQ2hDLElBQUssSUFBQSxDQUFBLGdCQUFBLEdBQW1CLGVBQWUsSUFBSyxDQUFBLGdCQUFBLENBQUE7QUFFNUMsSUFBTSxNQUFBLFNBQUEsR0FBWSxnQkFBaUIsQ0FBQSxJQUFBLENBQUssVUFBVSxDQUFBLENBQUE7QUFDbEQsSUFBQSxJQUFBLENBQUssaUJBQWlCLFNBQVUsQ0FBQSxTQUFBLENBQUE7QUFDaEMsSUFBQSxJQUFBLENBQUssZ0JBQWdCLFNBQVUsQ0FBQSxRQUFBLENBQUE7QUFFL0IsSUFBTyxPQUFBLElBQUEsQ0FBQTtBQUFBLEdBQ1I7QUFBQSxFQVVELEtBQUssY0FBZ0IsRUFBQTtBQUNuQixJQUFBLElBQUEsQ0FBSyxXQUFXLGNBQWMsQ0FBQSxDQUFBO0FBQzlCLElBQUksSUFBQSxRQUFBLEdBQVdBLFVBQVEsUUFBWSxJQUFBLENBQUEsQ0FBQTtBQUNuQyxJQUFBLElBQUksYUFBYSxDQUFLLElBQUEsY0FBQSxJQUFrQixPQUFPLGNBQW1CLEtBQUEsVUFBQSxJQUFjLGVBQWUsS0FBTyxFQUFBO0FBQ3BHLE1BQVcsUUFBQSxHQUFBLENBQUEsQ0FBQTtBQUFBLEtBQ1o7QUFFRCxJQUFLLElBQUEsQ0FBQSxLQUFBLENBQU0sUUFBVSxFQUFBLGdCQUFBLEVBQWtCLGNBQWMsQ0FBQSxDQUFBO0FBQUEsR0FDdEQ7QUFBQSxFQVlELFdBQUEsQ0FBWSxVQUFVLElBQU0sRUFBQTtBQUMxQixJQUFBLE1BQU0sYUFBZ0IsR0FBQSxDQUFDLFdBQWEsRUFBQSxRQUFBLEVBQVUsU0FBUyxVQUFVLENBQUEsQ0FBQTtBQUNqRSxJQUFBLElBQUksQ0FBQyxhQUFBLENBQWMsUUFBUyxDQUFBLFFBQVEsQ0FBRyxFQUFBO0FBQ3JDLE1BQUEsTUFBTSxJQUFJLEtBQU0sQ0FBQSxDQUFBO0FBQUEsa0JBQ0YsRUFBQSxhQUFBLENBQWMsSUFBSyxDQUFBLE1BQU0sQ0FBSSxDQUFBLENBQUEsQ0FBQSxDQUFBLENBQUE7QUFBQSxLQUM1QztBQUNELElBQUEsTUFBTSxZQUFZLENBQUcsRUFBQSxRQUFBLENBQUEsSUFBQSxDQUFBLENBQUE7QUFDckIsSUFBSyxJQUFBLENBQUEsRUFBQSxDQUFHLFNBQVcsRUFBQSxDQUFDLE9BQVksS0FBQTtBQUM5QixNQUFJLElBQUEsT0FBQSxDQUFBO0FBQ0osTUFBSSxJQUFBLE9BQU8sU0FBUyxVQUFZLEVBQUE7QUFDOUIsUUFBVSxPQUFBLEdBQUEsSUFBQSxDQUFLLEVBQUUsS0FBTyxFQUFBLE9BQUEsQ0FBUSxPQUFPLE9BQVMsRUFBQSxPQUFBLENBQVEsU0FBUyxDQUFBLENBQUE7QUFBQSxPQUM1RCxNQUFBO0FBQ0wsUUFBVSxPQUFBLEdBQUEsSUFBQSxDQUFBO0FBQUEsT0FDWDtBQUVELE1BQUEsSUFBSSxPQUFTLEVBQUE7QUFDWCxRQUFBLE9BQUEsQ0FBUSxNQUFNLENBQUcsRUFBQSxPQUFBLENBQUE7QUFBQSxDQUFXLENBQUEsQ0FBQTtBQUFBLE9BQzdCO0FBQUEsS0FDRixDQUFBLENBQUE7QUFDRCxJQUFPLE9BQUEsSUFBQSxDQUFBO0FBQUEsR0FDUjtBQUNILENBQUE7QUFVQSxTQUFBLHFCQUFBLENBQStCLEtBQUssSUFBTSxFQUFBO0FBQ3hDLEVBQU0sTUFBQSxVQUFBLEdBQWEsR0FBSSxDQUFBLGNBQUEsSUFBa0IsSUFBSyxDQUFBLElBQUEsQ0FBSyxDQUFPLEdBQUEsS0FBQSxHQUFBLEtBQVEsR0FBSSxDQUFBLGFBQUEsSUFBaUIsR0FBUSxLQUFBLEdBQUEsQ0FBSSxjQUFjLENBQUEsQ0FBQTtBQUNqSCxFQUFBLElBQUksVUFBWSxFQUFBO0FBQ2QsSUFBQSxHQUFBLENBQUksVUFBVSxFQUFBLENBQUE7QUFFZCxJQUFJLEdBQUEsQ0FBQSxLQUFBLENBQU0sQ0FBRyxFQUFBLHlCQUFBLEVBQTJCLGNBQWMsQ0FBQSxDQUFBO0FBQUEsR0FDdkQ7QUFDSCxDQUFBO0FBVUEsU0FBQSwwQkFBQSxDQUFvQyxJQUFNLEVBQUE7QUFLeEMsRUFBTyxPQUFBLElBQUEsQ0FBSyxHQUFJLENBQUEsQ0FBQyxHQUFRLEtBQUE7QUFDdkIsSUFBQSxJQUFJLENBQUMsR0FBQSxDQUFJLFVBQVcsQ0FBQSxXQUFXLENBQUcsRUFBQTtBQUNoQyxNQUFPLE9BQUEsR0FBQSxDQUFBO0FBQUEsS0FDUjtBQUNELElBQUksSUFBQSxXQUFBLENBQUE7QUFDSixJQUFBLElBQUksU0FBWSxHQUFBLFdBQUEsQ0FBQTtBQUNoQixJQUFBLElBQUksU0FBWSxHQUFBLE1BQUEsQ0FBQTtBQUNoQixJQUFJLElBQUEsS0FBQSxDQUFBO0FBQ0osSUFBQSxJQUFLLENBQVEsS0FBQSxHQUFBLEdBQUEsQ0FBSSxLQUFNLENBQUEsc0JBQXNCLE9BQU8sSUFBTSxFQUFBO0FBRXhELE1BQUEsV0FBQSxHQUFjLEtBQU0sQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLGVBQ1YsQ0FBUSxLQUFBLEdBQUEsR0FBQSxDQUFJLEtBQU0sQ0FBQSxvQ0FBb0MsT0FBTyxJQUFNLEVBQUE7QUFDN0UsTUFBQSxXQUFBLEdBQWMsS0FBTSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQ3BCLE1BQUEsSUFBSSxPQUFRLENBQUEsSUFBQSxDQUFLLEtBQU0sQ0FBQSxDQUFBLENBQUUsQ0FBRyxFQUFBO0FBRTFCLFFBQUEsU0FBQSxHQUFZLEtBQU0sQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLE9BQ2IsTUFBQTtBQUVMLFFBQUEsU0FBQSxHQUFZLEtBQU0sQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLE9BQ25CO0FBQUEsZUFDUyxDQUFRLEtBQUEsR0FBQSxHQUFBLENBQUksS0FBTSxDQUFBLDBDQUEwQyxPQUFPLElBQU0sRUFBQTtBQUVuRixNQUFBLFdBQUEsR0FBYyxLQUFNLENBQUEsQ0FBQSxDQUFBLENBQUE7QUFDcEIsTUFBQSxTQUFBLEdBQVksS0FBTSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQ2xCLE1BQUEsU0FBQSxHQUFZLEtBQU0sQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLEtBQ25CO0FBRUQsSUFBSSxJQUFBLFdBQUEsSUFBZSxjQUFjLEdBQUssRUFBQTtBQUNwQyxNQUFBLE9BQU8sQ0FBRyxFQUFBLFdBQUEsQ0FBQSxDQUFBLEVBQWUsU0FBYSxDQUFBLENBQUEsRUFBQSxRQUFBLENBQVMsU0FBUyxDQUFJLEdBQUEsQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLEtBQzdEO0FBQ0QsSUFBTyxPQUFBLEdBQUEsQ0FBQTtBQUFBLEdBQ1IsQ0FBQSxDQUFBO0FBQ0gsQ0FBQTtBQVFBLFNBQUEsb0JBQUEsQ0FBOEIsWUFBYyxFQUFBO0FBQzFDLEVBQUEsTUFBTSxTQUFTLEVBQUEsQ0FBQTtBQUNmLEVBQUEsS0FBQSxJQUFTLFFBQVUsR0FBQSxZQUFBLEVBQWMsUUFBUyxFQUFBLFFBQUEsR0FBVSxTQUFRLE1BQVEsRUFBQTtBQUNsRSxJQUFBLE1BQUEsQ0FBTyxLQUFLLFFBQU8sQ0FBQSxDQUFBO0FBQUEsR0FDcEI7QUFDRCxFQUFPLE9BQUEsTUFBQSxDQUFBO0FBQ1QsQ0FBQTtBQUVBLFFBQUEsT0FBa0IsR0FBQU07OztBQ2pqRWxCLEVBQUEsTUFBTSxFQUFFLFFBQWEsRUFBQSxHQUFBZCxRQUFBLENBQUE7QUFDckIsRUFBQSxNQUFNLEVBQUUsT0FBWSxFQUFBLEdBQUFlLE9BQUEsQ0FBQTtBQUNwQixFQUFNLE1BQUEsRUFBRSxnQkFBZ0Isb0JBQXlCLEVBQUEsR0FBQUMsS0FBQSxDQUFBO0FBQ2pELEVBQUEsTUFBTSxFQUFFLElBQVMsRUFBQSxHQUFBQyxJQUFBLENBQUE7QUFDakIsRUFBQSxNQUFNLEVBQUUsTUFBVyxFQUFBLEdBQUFDLE1BQUEsQ0FBQTtBQVFuQixFQUFVLE9BQUEsR0FBQSxNQUFBLENBQUEsT0FBaUIsR0FBQSxJQUFJO0FBQy9CLEVBQUEsT0FBQSxDQUFBLE9BQWtCLEdBQUEsT0FBQSxDQUFBO0FBT2xCLEVBQUEsT0FBQSxDQUFBLFFBQW1CLEdBQUEsUUFBQSxDQUFBO0FBQ25CLEVBQUEsT0FBQSxDQUFBLE9BQWtCLEdBQUEsT0FBQSxDQUFBO0FBQ2xCLEVBQUEsT0FBQSxDQUFBLGNBQXlCLEdBQUEsY0FBQSxDQUFBO0FBQ3pCLEVBQUEsT0FBQSxDQUFBLElBQWUsR0FBQSxJQUFBLENBQUE7QUFDZixFQUFBLE9BQUEsQ0FBQSxvQkFBK0IsR0FBQSxvQkFBQSxDQUFBO0FBQy9CLEVBQUEsT0FBQSxDQUFBLDBCQUFxQyxHQUFBLG9CQUFBLENBQUE7QUFDckMsRUFBQSxPQUFBLENBQUEsTUFBaUIsR0FBQSxNQUFBLENBQUE7Ozs7QUN2QlYsTUFBTTtBQUFBLEVBQ1gsT0FBQTtBQUFBLEVBQ0EsYUFBQTtBQUFBLEVBQ0EsY0FBQTtBQUFBLEVBQ0EsWUFBQTtBQUFBLEVBQ0EsY0FBQTtBQUFBLEVBQ0Esb0JBQUE7QUFBQSxFQUNBLE9BQUE7QUFBQSxFQUNBLFFBQUE7QUFBQSxFQUNBLE1BQUE7QUFBQSxFQUNBLElBQUE7QUFBQSxDQUNFLEdBQUFDLGlCQUFBOzs7O0FDZEosSUFBSSxHQUFNLEdBQUFuQixZQUFBLENBQUE7QUFFVixJQUFJLGdCQUNILEdBQUEsRUFBZ0IsVUFBQSxJQUFBLE9BQUEsQ0FBUSxHQUFPLElBQUEsT0FBQSxDQUFRLElBQUssQ0FBQSxRQUFBLENBQVMsWUFBWSxDQUFBLENBQUEsS0FDL0MsYUFBQSxJQUFBLE9BQUEsQ0FBUSxPQUN6QixPQUFRLENBQUEsSUFBQSxDQUFLLFFBQVMsQ0FBQSxTQUFTLENBQy9CLElBQUEsT0FBQSxDQUFRLFFBQWEsS0FBQSxPQUFBLElBQ3BCLEdBQUksQ0FBQSxNQUFBLENBQU8sQ0FBQyxDQUFBLElBQUssT0FBUSxDQUFBLEdBQUEsQ0FBSSxJQUFTLEtBQUEsTUFBQSxJQUN2QyxRQUFRLE9BQVEsQ0FBQSxHQUFBLENBQUEsQ0FBQTtBQUVsQixJQUFJLFlBQ0gsQ0FBQyxJQUFBLEVBQU0sS0FBTyxFQUFBLE9BQUEsR0FBVSxTQUN4QixDQUFTLEtBQUEsS0FBQTtBQUNSLEVBQUEsSUFBSSxTQUFTLEVBQUssR0FBQSxLQUFBLENBQUE7QUFDbEIsRUFBQSxJQUFJLEtBQVEsR0FBQSxNQUFBLENBQU8sT0FBUSxDQUFBLEtBQUEsRUFBTyxLQUFLLE1BQU0sQ0FBQSxDQUFBO0FBQzdDLEVBQU8sT0FBQSxDQUFDLEtBQ0wsR0FBQSxJQUFBLEdBQU8sWUFBYSxDQUFBLE1BQUEsRUFBUSxLQUFPLEVBQUEsT0FBQSxFQUFTLEtBQUssQ0FBQSxHQUFJLEtBQ3JELEdBQUEsSUFBQSxHQUFPLE1BQVMsR0FBQSxLQUFBLENBQUE7QUFDbkIsQ0FBQSxDQUFBO0FBRUYsSUFBSSxZQUFlLEdBQUEsQ0FBQyxNQUFRLEVBQUEsS0FBQSxFQUFPLFNBQVMsS0FBVSxLQUFBO0FBQ3JELEVBQUEsSUFBSSxLQUFRLEdBQUEsTUFBQSxDQUFPLFNBQVUsQ0FBQSxDQUFBLEVBQUcsS0FBSyxDQUFJLEdBQUEsT0FBQSxDQUFBO0FBQ3pDLEVBQUEsSUFBSSxHQUFNLEdBQUEsTUFBQSxDQUFPLFNBQVUsQ0FBQSxLQUFBLEdBQVEsTUFBTSxNQUFNLENBQUEsQ0FBQTtBQUMvQyxFQUFJLElBQUEsU0FBQSxHQUFZLEdBQUksQ0FBQSxPQUFBLENBQVEsS0FBSyxDQUFBLENBQUE7QUFDakMsRUFBTyxPQUFBLENBQUMsWUFBWSxLQUFRLEdBQUEsWUFBQSxDQUFhLEtBQUssS0FBTyxFQUFBLE9BQUEsRUFBUyxTQUFTLENBQUEsR0FBSSxLQUFRLEdBQUEsR0FBQSxDQUFBO0FBQ3BGLENBQUEsQ0FBQTtBQUVBLElBQUksWUFBQSxHQUFlLENBQUMsT0FBQSxHQUFVLGdCQUFzQixNQUFBO0FBQUEsRUFDbkQsZ0JBQWtCLEVBQUEsT0FBQTtBQUFBLEVBQ2xCLEtBQU8sRUFBQSxPQUFBLEdBQVUsQ0FBSyxDQUFBLEtBQUEsQ0FBQSxPQUFBLEVBQVUsQ0FBYSxDQUFBLE9BQUEsQ0FBQSxHQUFBLE1BQUE7QUFBQSxFQUM3QyxNQUFNLE9BQVUsR0FBQSxTQUFBLENBQVUsU0FBVyxFQUFBLFVBQUEsRUFBWSxpQkFBaUIsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUN0RSxLQUFLLE9BQVUsR0FBQSxTQUFBLENBQVUsU0FBVyxFQUFBLFVBQUEsRUFBWSxpQkFBaUIsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUNyRSxNQUFRLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxTQUFBLEVBQVcsVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUFBLEVBQ3JELFNBQVcsRUFBQSxPQUFBLEdBQVUsU0FBVSxDQUFBLFNBQUEsRUFBVyxVQUFVLENBQUksR0FBQSxNQUFBO0FBQUEsRUFDeEQsT0FBUyxFQUFBLE9BQUEsR0FBVSxTQUFVLENBQUEsU0FBQSxFQUFXLFVBQVUsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUN0RCxNQUFRLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxTQUFBLEVBQVcsVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUFBLEVBQ3JELGFBQWUsRUFBQSxPQUFBLEdBQVUsU0FBVSxDQUFBLFNBQUEsRUFBVyxVQUFVLENBQUksR0FBQSxNQUFBO0FBQUEsRUFDNUQsS0FBTyxFQUFBLE9BQUEsR0FBVSxTQUFVLENBQUEsVUFBQSxFQUFZLFVBQVUsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUNyRCxHQUFLLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxVQUFBLEVBQVksVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUFBLEVBQ25ELEtBQU8sRUFBQSxPQUFBLEdBQVUsU0FBVSxDQUFBLFVBQUEsRUFBWSxVQUFVLENBQUksR0FBQSxNQUFBO0FBQUEsRUFDckQsTUFBUSxFQUFBLE9BQUEsR0FBVSxTQUFVLENBQUEsVUFBQSxFQUFZLFVBQVUsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUN0RCxJQUFNLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxVQUFBLEVBQVksVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUFBLEVBQ3BELE9BQVMsRUFBQSxPQUFBLEdBQVUsU0FBVSxDQUFBLFVBQUEsRUFBWSxVQUFVLENBQUksR0FBQSxNQUFBO0FBQUEsRUFDdkQsSUFBTSxFQUFBLE9BQUEsR0FBVSxTQUFVLENBQUEsVUFBQSxFQUFZLFVBQVUsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUNwRCxLQUFPLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxVQUFBLEVBQVksVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUFBLEVBQ3JELElBQU0sRUFBQSxPQUFBLEdBQVUsU0FBVSxDQUFBLFVBQUEsRUFBWSxVQUFVLENBQUksR0FBQSxNQUFBO0FBQUEsRUFDcEQsT0FBUyxFQUFBLE9BQUEsR0FBVSxTQUFVLENBQUEsVUFBQSxFQUFZLFVBQVUsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUN2RCxLQUFPLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxVQUFBLEVBQVksVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUFBLEVBQ3JELE9BQVMsRUFBQSxPQUFBLEdBQVUsU0FBVSxDQUFBLFVBQUEsRUFBWSxVQUFVLENBQUksR0FBQSxNQUFBO0FBQUEsRUFDdkQsUUFBVSxFQUFBLE9BQUEsR0FBVSxTQUFVLENBQUEsVUFBQSxFQUFZLFVBQVUsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUN4RCxNQUFRLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxVQUFBLEVBQVksVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUFBLEVBQ3RELFNBQVcsRUFBQSxPQUFBLEdBQVUsU0FBVSxDQUFBLFVBQUEsRUFBWSxVQUFVLENBQUksR0FBQSxNQUFBO0FBQUEsRUFDekQsTUFBUSxFQUFBLE9BQUEsR0FBVSxTQUFVLENBQUEsVUFBQSxFQUFZLFVBQVUsQ0FBSSxHQUFBLE1BQUE7QUFBQSxFQUN0RCxPQUFTLEVBQUEsT0FBQSxHQUFVLFNBQVUsQ0FBQSxVQUFBLEVBQVksVUFBVSxDQUFJLEdBQUEsTUFBQTtBQUN4RCxDQUFBLENBQUEsQ0FBQTtBQUVBb0IsVUFBQSxDQUFjLFVBQUcsWUFBYyxFQUFBLENBQUE7QUFDL0JDLG1CQUFBLFlBQThCLEdBQUE7O0FDcER2QixNQUFNLHNDQUFBLEdBQXlDLENBQUMsSUFFakQsS0FBQTtBQUdKLEVBQUEsTUFBTSxhQUFhLGFBQWMsQ0FBQSxJQUFJLEdBQUksQ0FBQSxJQUFBLENBQUssYUFBYSxDQUFDLENBQUEsQ0FBQTtBQUM1RCxFQUFNLE1BQUEsTUFBQSxHQUFTLFFBQVEsVUFBVSxDQUFBLENBQUE7QUFDakMsRUFBTSxNQUFBLFdBQUEsR0FBYyxRQUFRLE1BQU0sQ0FBQSxDQUFBO0FBRWxDLEVBQUEsTUFBTSxlQUFrQixHQUFBLE1BQU0sTUFBTyxDQUFBLFFBQUEsQ0FBUyxPQUFPLENBQUEsQ0FBQTtBQUNyRCxFQUFNLE1BQUEsY0FBQSxHQUFpQixNQUNyQixNQUFPLENBQUEsUUFBQSxDQUFTLE1BQU0sQ0FBSyxJQUFBLENBQUMsV0FBWSxDQUFBLFFBQUEsQ0FBUyxNQUFNLENBQUEsQ0FBQTtBQUV6RCxFQUFJLElBQUEsZUFBQSxFQUFxQixJQUFBLGNBQUEsRUFBa0IsRUFBQTtBQUN6QyxJQUFBLE9BQU8sY0FBYyxJQUFJLEdBQUEsQ0FBSSxDQUFPLEdBQUEsQ0FBQSxFQUFBLElBQUEsQ0FBSyxhQUFhLENBQUMsQ0FBQSxDQUFBO0FBQUEsR0FDekQ7QUFHQSxFQUFBLE9BQU8sY0FBYyxJQUFJLEdBQUEsQ0FBSSxDQUFVLE1BQUEsQ0FBQSxFQUFBLElBQUEsQ0FBSyxhQUFhLENBQUMsQ0FBQSxDQUFBO0FBQzVELENBQUEsQ0FBQTtBQUVPLE1BQU0sbUJBQUEsR0FBc0IsS0FBSyxNQUN0QyxzQ0FBQSxDQUF1QyxFQUFFLGFBQWUsRUFBQSxNQUFBLENBQUEsSUFBQSxDQUFZLEdBQUksRUFBQyxDQUMzRSxDQUFBOztBQ3hCTyxTQUFBLGNBQUEsQ0FBd0IsdUJBQWlDLEVBQUE7QUFDOUQsRUFBQSxPQUFPLElBQUssQ0FBQSxtQkFBQSxFQUF1QixFQUFBLENBQUEsVUFBQSxFQUFhLHVCQUF5QixDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQzNFOztBQ01PLE1BQU0saUJBQUEsR0FBb0IsT0FBTyxZQUF5QixLQUFBO0FBQy9ELEVBQUksSUFBQTtBQUNGLElBQUEsTUFBTSxPQUFPLE1BQU0sUUFBQSxDQUNqQixLQUFLLFlBQWMsRUFBQSxxQkFBcUIsR0FDeEMsT0FDRixDQUFBLENBQUE7QUFDQSxJQUFNLE1BQUEsUUFBQSxHQUFXLEtBQUssSUFBSSxDQUFBLENBQUE7QUFHMUIsSUFBTyxPQUFBLFFBQUEsQ0FBUyxZQUFZLEVBQUMsQ0FBQTtBQUFBLFdBQ3RCLEdBQVAsRUFBQTtBQUNBLElBQUEsTUFBQSxDQUFPLE1BQU0sR0FBRyxDQUFBLENBQUE7QUFDaEIsSUFBQSxPQUFPLEVBQUMsQ0FBQTtBQUFBLEdBQ1Y7QUFDRixDQUFBOztBQ25CQSxlQUE0QywwQkFBQSxHQUFBO0FBQzFDLEVBQU0sTUFBQSxJQUFBLEdBQU8sTUFBTSxnQkFBaUIsRUFBQSxDQUFBO0FBQ3BDLEVBQU0sTUFBQSxRQUFBLEdBQVcsSUFBSyxDQUFBLElBQUEsRUFBTSxzQkFBc0IsQ0FBQSxDQUFBO0FBQ2xELEVBQUEsTUFBTSxrQkFBcUIsR0FBQSxNQUFNLElBQUssQ0FBQSxRQUFRLEVBQzNDLElBQUssQ0FBQSxDQUFDLE1BQVcsS0FBQSxNQUFBLENBQU8sTUFBTyxFQUFDLENBQ2hDLENBQUEsS0FBQSxDQUFNLE1BQU0sS0FBSyxDQUFBLENBQUE7QUFFcEIsRUFBQSxJQUFJLGtCQUFvQixFQUFBO0FBQ3RCLElBQUEsT0FBQTtBQUFBLEdBQ0Y7QUFDQSxFQUFBLE1BQU0sSUFBTyxHQUFBLE1BQU0sUUFBUyxDQUFBLGNBQUEsQ0FBZSw2QkFBNkIsQ0FBRyxFQUFBO0FBQUEsSUFDekUsUUFBVSxFQUFBLE9BQUE7QUFBQSxHQUNYLENBQUEsQ0FBQTtBQUNELEVBQU0sTUFBQSxLQUFBLEdBQVEsTUFBTSxpQkFBQSxDQUFrQixJQUFJLENBQUEsQ0FBQTtBQUMxQyxFQUFBLE1BQU0sVUFDSixRQUNBLEVBQUEsSUFBQSxDQUFLLE9BQ0gsQ0FBQSxPQUFBLEVBQ0EsS0FBSyxTQUFVLENBQUE7QUFBQSxJQUNiLEdBQUcsSUFBSSxHQUNMLENBQUEsS0FBQSxDQUFNLEdBQUksQ0FBQSxDQUFDLElBQVUsS0FBQSxJQUFBLEtBQVMsR0FBTSxHQUFBLENBQUEsRUFBRyxJQUFjLENBQUEsS0FBQSxDQUFBLEdBQUEsQ0FBQSxJQUFBLENBQU8sQ0FDOUQsQ0FBQTtBQUFBLEdBQ0QsQ0FDSCxDQUNGLENBQUEsQ0FBQTtBQUNGLENBQUE7QUFFQSxlQUE4Qyw0QkFBQSxHQUFBO0FBQzVDLEVBQU0sTUFBQSxJQUFBLEdBQU8sTUFBTSxnQkFBaUIsRUFBQSxDQUFBO0FBQ3BDLEVBQU0sTUFBQSxRQUFBLEdBQVcsSUFBSyxDQUFBLElBQUEsRUFBTSxlQUFlLENBQUEsQ0FBQTtBQUMzQyxFQUFBLE1BQU0sa0JBQXFCLEdBQUEsTUFBTSxJQUFLLENBQUEsUUFBUSxFQUMzQyxJQUFLLENBQUEsQ0FBQyxNQUFXLEtBQUEsTUFBQSxDQUFPLE1BQU8sRUFBQyxDQUNoQyxDQUFBLEtBQUEsQ0FBTSxNQUFNLEtBQUssQ0FBQSxDQUFBO0FBRXBCLEVBQUEsSUFBSSxrQkFBb0IsRUFBQTtBQUN0QixJQUFBLE9BQUE7QUFBQSxHQUNGO0FBQ0EsRUFBQSxNQUFNLElBQU8sR0FBQSxNQUFNLFFBQVMsQ0FBQSxjQUFBLENBQWUsdUJBQXVCLENBQUcsRUFBQTtBQUFBLElBQ25FLFFBQVUsRUFBQSxPQUFBO0FBQUEsR0FDWCxDQUFBLENBQUE7QUFDRCxFQUFNLE1BQUEsU0FBQSxDQUFVLFVBQVUsSUFBSSxDQUFBLENBQUE7QUFDaEMsQ0FBQTtBQUVBLGVBQXFELDRCQUFBLEdBQUE7QUFDbkQsRUFBQSxNQUFNLFFBQVEsR0FBSSxDQUFBO0FBQUEsSUFDaEIsMEJBQTJCLEVBQUE7QUFBQSxJQUMzQiw0QkFBNkIsRUFBQTtBQUFBLEdBQzlCLENBQUEsQ0FBQTtBQUNIOztBQ25ETyxTQUFBLGNBQUEsQ0FBd0IsR0FBYSxFQUFBO0FBQzFDLEVBQUEsT0FBTyxJQUFLLENBQUEsbUJBQUEsRUFBdUIsRUFBQSxDQUFBLG9CQUFBLEVBQXVCLEdBQUssQ0FBQSxDQUFBLENBQUEsQ0FBQTtBQUNqRTs7QUNJQSxNQUFNLFVBQUEsR0FBYSxNQUFNLGNBQUEsQ0FBZSxRQUFRLENBQUEsQ0FBQTtBQUVoRCxNQUFNLGdCQUFBLEdBQW1CLE1BQU0sY0FBQSxDQUFlLDBCQUEwQixDQUFBLENBQUE7QUFFakUsTUFBTUMsV0FBUyxPQUFPLFdBQUEsS0FDM0IsY0FDRSxDQUFBLFVBQUEsSUFDQSxZQUNFLENBQUE7QUFBQSxFQUNFLGVBQWUsQ0FBQyxVQUFVLENBQUcsRUFBQSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0FBQUEsRUFDckMsZUFDRSxDQUFDLE9BQU8sQ0FDUixFQUFBLENBQUMsQ0FBQyxLQUFPLEVBQUEsTUFBQSxFQUFRLEtBQU8sRUFBQSxNQUFBLEVBQVEsUUFBUSxPQUFPLENBQUEsQ0FBRSxJQUFLLENBQUEsR0FBRyxDQUFDLENBQzVELENBQUE7QUFBQSxFQUNBLGNBQUEsQ0FBZSxDQUFDLFVBQVksRUFBQSxJQUFJLEdBQUcsQ0FBQyxnQkFBQSxFQUFrQixDQUFDLENBQUE7QUFBQSxFQUN2RCxjQUNFLENBQUEsQ0FBQyxPQUFPLENBQUEsRUFDUixFQUNBLEVBQUEsQ0FBQyxJQUFTLEtBQUEsQ0FBQyxjQUFjLElBQUssQ0FBQSxTQUFBLEVBQVcsQ0FBQyxVQUFVLENBQUMsQ0FDdkQsQ0FBQTtBQUFBLEVBRUEsZUFBQSxDQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFBO0FBQUEsRUFDNUIsQ0FBQyxJQUFVLE1BQUE7QUFBQSxJQUNULEdBQUcsSUFBQTtBQUFBLElBRUgsU0FBQSxFQUFXLEtBQUssU0FBVSxDQUFBLE1BQUEsS0FBVyxJQUFJLENBQUMsR0FBRyxJQUFJLElBQUssQ0FBQSxTQUFBO0FBQUEsR0FDeEQsQ0FBQTtBQUNGLENBQUEsRUFDQSxXQUNGLENBQ0EsRUFBQTtBQUFBLEVBQ0UsS0FBTyxFQUFBLFNBQUE7QUFDVCxDQUNGLENBQUE7O0FDdkJLLFNBQUEsV0FBQSxDQUNMLElBQzBCLEVBQUE7QUFDMUIsRUFBTyxPQUFBLElBQUEsQ0FBQTtBQUNUOztBQ25CQSxlQUE2QyxvQkFBQSxHQUFBO0FBQzNDLEVBQUEsTUFBTSxrQkFBcUIsR0FBQSxJQUFBLENBQUssT0FBUSxDQUFBLEdBQUEsSUFBTyxjQUFjLENBQUEsQ0FBQTtBQUM3RCxFQUFBLE1BQU0saUJBQW9CLEdBQUEsTUFBTSxJQUFLLENBQUEsa0JBQWtCLEVBQ3BELElBQUssQ0FBQSxDQUFDLE1BQVcsS0FBQSxNQUFBLENBQU8sTUFBTyxFQUFDLENBQ2hDLENBQUEsS0FBQSxDQUFNLE1BQU0sS0FBSyxDQUFBLENBQUE7QUFDcEIsRUFBQSxJQUFJLENBQUMsaUJBQW1CLEVBQUE7QUFDdEIsSUFBQSxPQUFBO0FBQUEsR0FDRjtBQUNBLEVBQUEsTUFBTSxRQUFXLEdBQUEsSUFBQSxDQUFLLE9BQVEsQ0FBQSxHQUFBLElBQU8sZUFBZSxDQUFBLENBQUE7QUFDcEQsRUFBQSxNQUFNLFlBQWUsR0FBQSxNQUFNLElBQUssQ0FBQSxRQUFRLEVBQ3JDLElBQUssQ0FBQSxDQUFDLE1BQVcsS0FBQSxNQUFBLENBQU8sTUFBTyxFQUFDLENBQ2hDLENBQUEsS0FBQSxDQUFNLE1BQU0sS0FBSyxDQUFBLENBQUE7QUFFcEIsRUFBQSxJQUFJLFlBQWMsRUFBQTtBQUNoQixJQUFBLE9BQUE7QUFBQSxHQUNGO0FBQ0EsRUFBQSxNQUFNLElBQU8sR0FBQSxNQUFNLFFBQVMsQ0FBQSxjQUFBLENBQWUsbUJBQW1CLENBQUcsRUFBQTtBQUFBLElBQy9ELFFBQVUsRUFBQSxPQUFBO0FBQUEsR0FDWCxDQUFBLENBQUE7QUFDRCxFQUFNLE1BQUEsU0FBQSxDQUFVLFVBQVUsSUFBSSxDQUFBLENBQUE7QUFDaEM7O0FDbkJBLE1BQU0sT0FBQSxHQUFVLE1BQU0sY0FBQSxDQUFlLEtBQUssQ0FBQSxDQUFBO0FBRTFDLE1BQU1DLFFBQU0sT0FBTyxJQUFBLEtBQ2pCLGNBQWUsQ0FBQSxPQUFBLElBQVcsSUFBTSxFQUFBO0FBQUEsRUFDOUIsS0FBTyxFQUFBLFNBQUE7QUFBQSxFQUdQLEtBQUssUUFBUyxDQUFBLE9BQUEsQ0FBUSxLQUFPLEVBQUEsTUFBTSxrQkFBa0IsQ0FBQTtBQUN2RCxDQUFDLENBQUEsQ0FBQTtBQUtJLE1BQU0sdUJBQUEsR0FBMEIsT0FBTyxnQkFBQSxLQUM1Q0EsS0FBSSxDQUFBLENBQUMsV0FBVyxJQUFLLENBQUEsZ0JBQUEsRUFBa0IsaUJBQWlCLENBQUMsQ0FBQyxDQUFBLENBQUE7QUFFckQsTUFBTSxxQkFBd0IsR0FBQSxZQUNuQyx1QkFBd0IsQ0FBQSxPQUFBLENBQVEsS0FBSyxDQUFBOztBQ3ZCdkMsZUFBQSxZQUFBLENBQ0UsSUFDNEUsRUFBQTtBQUM1RSxFQUFBLE1BQU0sT0FBVSxHQUFBLE1BQU0sT0FBUSxDQUFBLFVBQUEsQ0FBVyxJQUFJLENBQUEsQ0FBQTtBQUM3QyxFQUFBLE1BQU0sVUFBYSxHQUFBLE9BQUEsQ0FBQTtBQUNuQixFQUFBLEtBQUEsTUFBVyxVQUFVLFVBQVksRUFBQTtBQUMvQixJQUFJLElBQUEsTUFBQSxDQUFPLFdBQVcsVUFBWSxFQUFBO0FBQ2hDLE1BQUEsTUFBTSxNQUFPLENBQUEsTUFBQSxDQUFBO0FBQUEsS0FDZjtBQUFBLEdBQ0Y7QUFDQSxFQUFPLE9BQUEsT0FBQSxDQUFBO0FBQ1Q7O0FDUU8sU0FBQSxJQUFBLENBQWMsSUFBa0MsRUFBQTtBQUNyRCxFQUFBLE9BQU8sV0FBWSxDQUFBO0FBQUEsSUFDakIsSUFBTSxFQUFBLE1BQUE7QUFBQSxJQUNOLElBQU0sRUFBQSxLQUFBLENBQUE7QUFBQSxJQUNOLFNBQVMsWUFBWTtBQUNuQixNQUFNLE1BQUEsSUFBQSxHQUFPLE1BQU0sZ0JBQWlCLEVBQUEsQ0FBQTtBQUNwQyxNQUFJLElBQUEsSUFBQSxLQUFTLE9BQVEsQ0FBQSxHQUFBLEVBQU8sRUFBQTtBQUMxQixRQUFBLE1BQU0sU0FBUyxNQUFNLElBQUEsQ0FBSyxPQUFPLENBQUUsQ0FBQSxLQUFBLENBQU0sTUFBTSxJQUFJLENBQUEsQ0FBQTtBQUNuRCxRQUFBLElBQUksQ0FBQyxNQUFBLElBQVUsQ0FBQyxNQUFBLENBQU8sYUFBZSxFQUFBO0FBQ3BDLFVBQUEsT0FBQTtBQUFBLFNBQ0Y7QUFBQSxPQUNGO0FBQ0EsTUFBQSxNQUFNLFlBQWEsQ0FBQTtBQUFBLFFBQ2pCLG9CQUFxQixFQUFBLENBQUUsSUFBSyxDQUFBLE1BQU0sdUJBQXVCLENBQUE7QUFBQSxRQUN6RCw4QkFBK0IsQ0FBQSxJQUFBLENBQUssTUFBTUQsUUFBTyxDQUFBLElBQUEsSUFBQSxJQUFBLEdBQUEsS0FBQSxDQUFBLEdBQUEsSUFBQSxDQUFNLFdBQVcsQ0FBQyxDQUFBO0FBQUEsT0FDcEUsQ0FBQSxDQUFBO0FBQUEsS0FDSDtBQUFBLEdBQ0QsQ0FBQSxDQUFBO0FBQ0g7O0FDL0JBLE1BQU0scUJBQXFCLE1BQU0sSUFBQSxDQUFLLE9BQVEsQ0FBQSxHQUFBLElBQU8sZ0JBQWdCLENBQUEsQ0FBQTtBQUVyRSxlQUFBLGlCQUFBLENBQWlDLElBQW9DLEVBQUE7QUFDbkUsRUFBTyxPQUFBLE1BQU0sUUFBUyxDQUFBLElBQUEsRUFBTSxPQUFPLENBQUEsQ0FBRSxJQUNuQyxDQUFBLENBQUMsTUFBVyxLQUFBLElBQUEsQ0FBSyxLQUFNLENBQUEsTUFBTSxDQUMvQixDQUFBLENBQUE7QUFDRixDQUFBO0FBRU8sTUFBTSxxQkFBcUIsU0FBVSxDQUFBLE1BQzFDLGlCQUFrQixDQUFBLGtCQUFBLEVBQW9CLENBQ3hDLENBQUE7O0FDUk8sU0FBbUMsdUJBQUEsR0FBQTtBQUN4QyxFQUFBLElBQUksMEJBQTBCLE9BQVMsRUFBQTtBQUNyQyxJQUFBLE9BQUEsQ0FBUSxxQkFBcUIsSUFBSSxDQUFBLENBQUE7QUFBQSxHQUNuQztBQUNGOztBQ0FBLE1BQU0sYUFBQSxHQUE2QyxDQUFDLE1BQU0sQ0FBQSxDQUFBO0FBRTFELE1BQU0sYUFBNkMsR0FBQTtBQUFBLEVBQ2pELE1BQUE7QUFBQSxFQUNBLE9BQUE7QUFBQSxFQUNBLE1BQUE7QUFBQSxFQUNBLGNBQUE7QUFBQSxFQUNBLGFBQUE7QUFDRixDQUFBLENBQUE7QUFZQSxlQUFBLFFBQUEsQ0FBQSxHQUNLLEtBQ1ksRUFBQTtBQUNmLEVBQU0sTUFBQSxLQUFBLEdBQVEsWUFBWSxHQUFJLEVBQUEsQ0FBQTtBQUM5QixFQUFJLElBQUE7QUFDRixJQUF3Qix1QkFBQSxFQUFBLENBQUE7QUFFeEIsSUFBTSxNQUFBLEVBQUUsUUFBUSxJQUFNLEVBQUEsSUFBQSxFQUFBLEdBQVMsTUFBTSxNQUtuQyxDQUFBLENBQUMsS0FBSyxJQUFTLEtBQUE7QUFDYixNQUFJLElBQUEsT0FBTyxTQUFTLFVBQVksRUFBQTtBQUM5QixRQUFJLEdBQUEsQ0FBQSxNQUFBLENBQU8sS0FBSyxJQUFJLENBQUEsQ0FBQTtBQUNwQixRQUFPLE9BQUEsR0FBQSxDQUFBO0FBQUEsT0FDVDtBQUNBLE1BQUEsSUFBSSxhQUFjLENBQUEsUUFBQSxDQUFTLElBQUssQ0FBQSxJQUFJLENBQUcsRUFBQTtBQUNyQyxRQUFJLEdBQUEsQ0FBQSxJQUFBLENBQUssS0FBSyxJQUFJLENBQUEsQ0FBQTtBQUNsQixRQUFPLE9BQUEsR0FBQSxDQUFBO0FBQUEsT0FDVDtBQUNBLE1BQUEsSUFBSSxhQUFjLENBQUEsUUFBQSxDQUFTLElBQUssQ0FBQSxJQUFJLENBQUcsRUFBQTtBQUNyQyxRQUFJLEdBQUEsQ0FBQSxJQUFBLENBQUssS0FBSyxJQUFJLENBQUEsQ0FBQTtBQUNsQixRQUFPLE9BQUEsR0FBQSxDQUFBO0FBQUEsT0FDVDtBQUNBLE1BQU8sT0FBQSxHQUFBLENBQUE7QUFBQSxLQUVULEVBQUE7QUFBQSxNQUNFLFFBQVEsRUFBQztBQUFBLE1BQ1QsTUFBTSxFQUFDO0FBQUEsTUFDUCxNQUFNLEVBQUM7QUFBQSxLQUVYLENBQUEsQ0FBQTtBQUVBLElBQU0sTUFBQSxXQUFBLEdBQWMsT0FBTyxJQUFlLEtBQUE7QUFsRTlDLE1BQUEsSUFBQSxFQUFBLENBQUE7QUFtRU0sTUFBSSxJQUFBO0FBQ0YsUUFBTyxPQUFBLE9BQU8sSUFBUyxLQUFBLFVBQUEsR0FDbkIsTUFBTSxJQUFBLEVBQ04sR0FBQSxNQUFNLE9BQVEsQ0FBQSxPQUFBLENBQVEsQ0FBSyxFQUFBLEdBQUEsSUFBQSxDQUFBLE9BQUEsS0FBTCxJQUFnQixHQUFBLEtBQUEsQ0FBQSxHQUFBLEVBQUEsQ0FBQSxJQUFBLENBQUEsSUFBQSxDQUFBLENBQUEsQ0FBQTtBQUFBLGVBQ25DLEdBQVAsRUFBQTtBQUNBLFFBQUEsTUFBQSxDQUFPLE1BQU0sR0FBRyxDQUFBLENBQUE7QUFDaEIsUUFBTyxNQUFBLENBQUEsS0FBQSxDQUNMRSxtQkFBSyxHQUNILENBQUEsQ0FBQTtBQUFBLGlCQUFBLEVBQXNCLEtBQUssSUFBUSxJQUFBLGdCQUFBLENBQUEsQ0FBQSxFQUFvQixNQUNwRCxDQUFBLENBQUEsTUFBTSxvQkFBc0IsRUFBQSxJQUMvQixDQUFNLENBQUEsRUFBQSxFQUFBLEdBQUEsWUFBZSxRQUFRLEdBQUksQ0FBQSxPQUFBLEdBQVUsTUFBTyxDQUFBLEdBQUcsSUFDdkQsQ0FDRixDQUFBLENBQUE7QUFDQSxRQUFPLE9BQUEsT0FBQSxDQUFRLE9BQU8sR0FBRyxDQUFBLENBQUE7QUFBQSxPQUMzQjtBQUFBLEtBQ0YsQ0FBQTtBQUVBLElBQU0sTUFBQSxZQUFBLENBQWEsQ0FBQyxHQUFHLElBQUEsRUFBTSxHQUFHLE1BQU0sQ0FBQSxDQUFFLEdBQUksQ0FBQSxXQUFXLENBQUMsQ0FBQSxDQUFBO0FBQ3hELElBQUEsTUFBTSxZQUFhLENBQUEsSUFBQSxDQUFLLEdBQUksQ0FBQSxXQUFXLENBQUMsQ0FBQSxDQUFBO0FBQUEsV0FDakMsR0FBUCxFQUFBO0FBQ0EsSUFBSSxJQUFBLE9BQU8sT0FBUSxDQUFBLFFBQUEsS0FBYSxRQUFVLEVBQUE7QUFDeEMsTUFBQSxPQUFBLENBQVEsUUFBVyxHQUFBLENBQUEsQ0FBQTtBQUFBLEtBQ3JCO0FBQUEsR0FDQSxTQUFBO0FBQ0EsSUFBTSxNQUFBLEdBQUEsR0FBTSxZQUFZLEdBQUksRUFBQSxDQUFBO0FBQzVCLElBQUEsTUFBTSxZQUFZLENBQUMsS0FBQSxLQUFrQixHQUFJLENBQVEsS0FBQSxHQUFBLEdBQUEsRUFBTSxRQUFRLENBQUMsQ0FBQSxDQUFBLENBQUEsQ0FBQSxDQUFBO0FBQ2hFLElBQUEsTUFBQSxDQUFPLEdBQUksQ0FBQSxDQUFBO0FBQUEsVUFBZSxFQUFBLFNBQUEsQ0FBVSxHQUFNLEdBQUEsS0FBSyxDQUFHLENBQUEsQ0FBQSxDQUFBLENBQUE7QUFBQSxHQUNwRDtBQUNGOztBQ3pGQSxNQUFNLE1BQUEsR0FBUyxNQUFNQyx5QkFBQSxDQUFPLFFBQVEsQ0FBQSxDQUFBO0FBRXBDLE1BQU0sR0FBQSxHQUFNLE1BQU1DLHVCQUFBLENBQUssS0FBSyxDQUFBLENBQUE7QUFFckIsTUFBTSxjQUFjLE1BQ3pCLElBQUksT0FBUSxDQUFBLE1BQU0sRUFDZixXQUNDLENBQUEsQ0FBQSw0RUFBQSxFQUErRSxNQUFPLEVBQUEsQ0FBQSxLQUFBLEVBQVMsS0FDakcsQ0FBQSxDQUFBLENBQUEsQ0FDQyxXQUFXLEtBQUssQ0FBQSxDQUNoQixZQUNDLE9BQ0EsRUFBQSxDQUFBO0FBQUEsRUFBSyxNQUFBLDBHQUNQLENBQ0MsQ0FBQSxrQkFBQSxDQUFtQixJQUFJLENBQ3ZCLENBQUEsTUFBQSxDQUFPLE9BQU8sS0FBQSxFQUFnQixPQUFxQixLQUFBO0FBQ2xELEVBQUksSUFBQSxPQUFBLENBQVEsS0FBSyxRQUFTLENBQUEsSUFBSSxLQUFLLE9BQVEsQ0FBQSxJQUFBLENBQUssUUFBUyxDQUFBLFFBQVEsQ0FBRyxFQUFBO0FBQ2xFLElBQVEsT0FBQSxDQUFBLEdBQUEsQ0FBSSxPQUFRLENBQUEsZUFBQSxFQUFpQixDQUFBLENBQUE7QUFBQSxHQUN2QztBQUNBLEVBQUEsTUFBTSxTQUFTLElBQUssQ0FBQSxFQUFFLGFBQWEsT0FBUSxDQUFBLElBQUEsRUFBTSxDQUFDLENBQUEsQ0FBQTtBQUNwRCxDQUFDLENBQUE7O0FDdEJRLE1BQUEsWUFBQSxHQUFlLE1BQzFCLElBQUksT0FBUSxDQUFBLE9BQU8sQ0FBRSxDQUFBLGtCQUFBLENBQW1CLElBQUksQ0FBQSxDQUFFLFVBQVcsQ0FBQSxXQUFBLEVBQWEsRUFBQTtBQUV4RSxlQUFxQixHQUFBLEdBQUE7QUFDbkIsRUFBTSxNQUFBLFlBQUEsR0FBZSxVQUFXLEVBQUEsQ0FBQTtBQUNsQyxDQUFBO0FBRUEsTUFBTSxHQUFJLEVBQUE7Ozs7In0=
