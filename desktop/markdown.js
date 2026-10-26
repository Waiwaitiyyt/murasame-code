(() => {
  const blockStarts = [
    /^\s*```/,
    /^#{1,6}\s+/, 
    /^>\s?/, 
    /^\s*[-+*]\s+/, 
    /^\s*\d+[.)]\s+/, 
    /^\s*(?:---+|___+|\*\*\*+)\s*$/,
  ];

  function isBlockStart(lines, index) {
    return blockStarts.some((pattern) => pattern.test(lines[index]));
  }

  function appendText(parent, text) {
    if (text) parent.append(document.createTextNode(text));
  }

  function safeHref(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function appendInline(parent, source) {
    let rest = source;
    while (rest) {
      if (rest.startsWith('\\') && rest.length > 1) {
        appendText(parent, rest[1]);
        rest = rest.slice(2);
        continue;
      }

      const code = rest.match(/^`([^`]+)`/);
      if (code) {
        const element = document.createElement('code');
        element.textContent = code[1];
        parent.append(element);
        rest = rest.slice(code[0].length);
        continue;
      }

      const link = rest.match(/^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/);
      if (link) {
        const href = safeHref(link[2]);
        if (href) {
          const element = document.createElement('a');
          element.href = href;
          element.rel = 'noopener noreferrer';
          element.target = '_blank';
          if (link[3]) element.title = link[3];
          appendInline(element, link[1]);
          parent.append(element);
        } else appendText(parent, link[0]);
        rest = rest.slice(link[0].length);
        continue;
      }

      const autoLink = rest.match(/^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/i);
      if (autoLink) {
        const element = document.createElement('a');
        element.href = safeHref(autoLink[1]);
        element.rel = 'noopener noreferrer';
        element.target = '_blank';
        element.textContent = autoLink[1];
        parent.append(element);
        rest = rest.slice(autoLink[0].length);
        continue;
      }

      const strong = rest.match(/^(?:\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*|__([^_]+(?:_(?!_)[^_]*)*)__)/);
      if (strong) {
        const element = document.createElement('strong');
        appendInline(element, strong[1] ?? strong[2]);
        parent.append(element);
        rest = rest.slice(strong[0].length);
        continue;
      }

      const strike = rest.match(/^~~([^~]+)~~/);
      if (strike) {
        const element = document.createElement('del');
        appendInline(element, strike[1]);
        parent.append(element);
        rest = rest.slice(strike[0].length);
        continue;
      }

      const emphasis = rest.match(/^(?:\*([^*\n]+)\*|_([^_\n]+)_)/);
      if (emphasis) {
        const element = document.createElement('em');
        appendInline(element, emphasis[1] ?? emphasis[2]);
        parent.append(element);
        rest = rest.slice(emphasis[0].length);
        continue;
      }

      const image = rest.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (image) {
        appendText(parent, image[1] || '图片');
        rest = rest.slice(image[0].length);
        continue;
      }

      let next = rest.length;
      for (const marker of ['\\', '`', '[', '<', '*', '_', '~', '!']) {
        const index = rest.indexOf(marker, 1);
        if (index !== -1 && index < next) next = index;
      }
      appendText(parent, rest.slice(0, next));
      rest = rest.slice(next);
    }
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
  }

  function renderBlocks(parent, lines) {
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index++; continue; }

      const fence = line.match(/^\s*```\s*([\w.+-]*)\s*$/);
      if (fence) {
        const codeLines = [];
        index++;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
        if (index < lines.length) index++;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (fence[1]) code.dataset.language = fence[1];
        code.textContent = codeLines.join('\n');
        pre.append(code);
        parent.append(pre);
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const element = document.createElement(`h${heading[1].length}`);
        appendInline(element, heading[2]);
        parent.append(element);
        index++;
        continue;
      }

      if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
        parent.append(document.createElement('hr'));
        index++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoted = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) quoted.push(lines[index++].replace(/^>\s?/, ''));
        const quote = document.createElement('blockquote');
        renderBlocks(quote, quoted);
        parent.append(quote);
        continue;
      }

      const listItem = line.match(/^\s*((?:[-+*])|(\d+)[.)])\s+(.+)$/);
      if (listItem) {
        const ordered = Boolean(listItem[2]);
        const list = document.createElement(ordered ? 'ol' : 'ul');
        if (ordered && Number(listItem[2]) !== 1) list.start = Number(listItem[2]);
        while (index < lines.length) {
          const item = lines[index].match(/^\s*((?:[-+*])|(\d+)[.)])\s+(.+)$/);
          if (!item || Boolean(item[2]) !== ordered) break;
          const li = document.createElement('li');
          appendInline(li, item[3]);
          list.append(li);
          index++;
        }
        parent.append(list);
        continue;
      }

      if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
        const headers = splitTableRow(line);
        const alignments = splitTableRow(lines[index + 1]).map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');
        const wrapper = document.createElement('div');
        wrapper.className = 'markdown-table-wrap';
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headers.forEach((text, column) => {
          const th = document.createElement('th');
          if (alignments[column]) th.style.textAlign = alignments[column];
          appendInline(th, text);
          headerRow.append(th);
        });
        thead.append(headerRow);
        table.append(thead);
        const tbody = document.createElement('tbody');
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          const row = document.createElement('tr');
          splitTableRow(lines[index]).forEach((text, column) => {
            const td = document.createElement('td');
            if (alignments[column]) td.style.textAlign = alignments[column];
            appendInline(td, text);
            row.append(td);
          });
          tbody.append(row);
          index++;
        }
        table.append(tbody);
        wrapper.append(table);
        parent.append(wrapper);
        continue;
      }

      const paragraphLines = [line];
      index++;
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) paragraphLines.push(lines[index++]);
      const paragraph = document.createElement('p');
      paragraphLines.forEach((text, lineIndex) => {
        if (lineIndex) {
          const previous = paragraphLines[lineIndex - 1];
          if (/ {2}$/.test(previous)) paragraph.append(document.createElement('br'));
          else appendText(paragraph, ' ');
        }
        appendInline(paragraph, text.replace(/ {2}$/, ''));
      });
      parent.append(paragraph);
    }
  }

  window.renderMurasameMarkdown = (container, markdown) => {
    container.replaceChildren();
    renderBlocks(container, String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n'));
  };
})();
