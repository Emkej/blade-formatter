const _ = require('lodash');
const fs = require('fs');
const chalk = require('chalk');
const prettier = require('prettier');
const detectIndent = require('detect-indent');
const { indentStartTokens } = require('./indent');

export const optional = (obj) => {
  const chain = {
    get() {
      return null;
    },
  };

  if (_.isUndefined(obj) || _.isNull(obj)) {
    return chain;
  }

  return obj;
};

export async function readFile(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

export function splitByLines(content) {
  if (!content) {
    return '';
  }

  return content.split(/\r\n|\n|\r/);
}

export function formatStringAsPhp(content) {
  return prettier.format(content, {
    parser: 'php',
    printWidth: 1000,
    singleQuote: true,
    phpVersion: '7.4',
  });
}

export function normalizeIndentLevel(length) {
  if (length < 0) {
    return 0;
  }

  return length;
}

export function printDiffs(diffs) {
  return Promise.all(
    _.map(diffs, async (diff) => {
      process.stdout.write(`path: ${chalk.bold(diff.path)}:${diff.line}\n`);
      process.stdout.write(chalk.red(`--${diff.original}\n`));
      process.stdout.write(chalk.green(`++${diff.formatted}\n`));
    }),
  );
}

export function generateDiff(path, originalLines, formattedLines) {
  const diff = _.map(originalLines, (originalLine, index) => {
    if (_.isEmpty(originalLine)) {
      return null;
    }

    if (originalLine === formattedLines[index]) {
      return null;
    }

    return {
      path,
      line: index + 1,
      original: originalLine,
      formatted: formattedLines[index],
    };
  });

  return _.without(diff, null);
}

export async function prettifyPhpContentWithUnescapedTags(content) {
  const directives = _.without(indentStartTokens, '@switch').join('|');

  const directiveRegexes = new RegExp(
    `(?!\\/\\*.*?\\*\\/)(${directives})\\s*?\\((.*)\\)`,
    'gm',
  );

  return new Promise((resolve) => resolve(content))
    .then((res) =>
      _.replace(res, /\{\{([^-].*?)\}\}/gs, (match, p1) => {
        return `<?php /*blade*/ ${p1} /*blade*/ ?>`;
      }),
    )
    .then((res) =>
      _.replace(res, directiveRegexes, (match, p1, p2) => {
        return formatStringAsPhp(`<?php ${p1.substr('1')}(${p2}) ?>`).replace(
          /<\?php\s(.*?)\((.*?)\);*\s\?>\n/gs,
          (match2, j1, j2) => {
            return `@${j1.trim()}(${j2.trim()})`;
          },
        );
      }),
    )
    .then((res) => formatStringAsPhp(res))
    .then((res) =>
      _.replace(
        res,
        /<\?php.*?\/\*blade\*\/\s(.*?)\s\/\*blade\*\/.*?\?>/gs,
        (match, p1) => {
          return `{{ ${p1} }}`;
        },
      ),
    );
}

export async function prettifyPhpContentWithEscapedTags(content) {
  return new Promise((resolve) => resolve(content))
    .then((res) => _.replace(res, /{!!/g, '<?php /*escaped*/'))
    .then((res) => _.replace(res, /!!}/g, '/*escaped*/ ?>'))
    .then((res) => formatStringAsPhp(res))
    .then((res) => _.replace(res, /<\?php\s\/\*escaped\*\//g, '{!! '))
    .then((res) => _.replace(res, /\/\*escaped\*\/\s\?>/g, ' !!}'));
}

export async function removeSemicolon(content) {
  return new Promise((resolve) => {
    resolve(content);
  })
    .then((res) => _.replace(res, /;\n.*!!\}/g, ' !!}'))
    .then((res) => _.replace(res, /;.*?!!}/g, ' !!}'))
    .then((res) => _.replace(res, /;\n.*}}/g, ' }}'))
    .then((res) => _.replace(res, /; }}/g, ' }}'))
    .then((res) => _.replace(res, /; --}}/g, ' --}}'));
}

export async function formatAsPhp(content) {
  return prettifyPhpContentWithEscapedTags(content)
    .then(prettifyPhpContentWithUnescapedTags)
    .then(removeSemicolon);
}

export async function preserveOriginalPhpTagInHtml(content) {
  return new Promise((resolve) => resolve(content))
    .then((res) => _.replace(res, /<\?php/g, '/* <?phptag_start */'))
    .then((res) => _.replace(res, /\?>/g, '/* end_phptag?> */'))
    .then((res) =>
      _.replace(res, /\{\{--(.*?)--\}\}/gs, (match, p1) => {
        return `<?php /*comment*/ ?>${p1}<?php /*comment*/ ?>`;
      }),
    );
}

export function revertOriginalPhpTagInHtml(content) {
  return new Promise((resolve) => resolve(content))
    .then((res) => _.replace(res, /\/\* <\?phptag_start \*\//g, '<?php'))
    .then((res) => _.replace(res, /\/\* end_phptag\?> \*\/\s;\n/g, '?>;'))
    .then((res) => _.replace(res, /\/\* end_phptag\?> \*\//g, '?>'))
    .then((res) =>
      _.replace(
        res,
        /<\?php.*?\/\*comment\*\/\s\?>(.*?)<\?php\s\/\*comment\*\/.*?\?>/gs,
        (match, p1) => {
          return `{{--${p1}--}}`;
        },
      ),
    );
}

export function unindent(directive, content, level, options) {
  const lines = content.split('\n');
  return _.map(lines, (line) => {
    if (!line.match(/\w/)) {
      return line;
    }

    const originalLineWhitespaces = detectIndent(line).amount;
    const indentChar = optional(options).useTabs ? '\t' : ' ';
    const indentSize = optional(options).indentSize || 4;
    const whitespaces = originalLineWhitespaces - indentSize * level;

    if (whitespaces < 0) {
      return line;
    }

    return indentChar.repeat(whitespaces) + line.trimLeft();
  }).join('\n');
}

export function preserveDirectives(content) {
  return _.replace(
    content,
    /(@foreach[\s]*|@for[\s]*)\((.*?)\)(.*?)(@endforeach|@endfor)/gs,
    (match, p1, p2, p3, p4) => {
      return `<beautify start="${p1}" end="${p4}" exp="^^${p2}^^">\
      ${p3}</beautify>`;
    },
  );
}

export function revertDirectives(content, options) {
  return _.replace(
    content,
    // eslint-disable-next-line max-len
    /<beautify start="(.*?)" end="(.*?)" exp="\^\^(.*?)\^\^">(.*?)<\/beautify>/gs,
    (match, p1, p2, p3, p4) => {
      return `${p1}(${p3})${unindent(p1, p4, 1, options)}${p2}`;
    },
  );
}

export function printDescription() {
  const returnLine = '\n\n';
  process.stdout.write(returnLine);
  process.stdout.write(chalk.bold.green('Fixed: F\n'));
  process.stdout.write(chalk.bold.red('Errors: E\n'));
  process.stdout.write(chalk.bold('Not Changed: ') + chalk.bold.green('.\n'));
}
