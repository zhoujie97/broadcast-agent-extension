// Keep native select values as the source of truth for existing generation logic.
(() => {
  const controls = [];
  for (const select of document.querySelectorAll('.remix-controls select')) {
    const field = select.parentElement;
    const label = field.querySelector('span');
    label.id ||= `${select.id}-label`;
    const wrapper = document.createElement('div');
    wrapper.className = 'paper-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'paper-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span');
    value.id = `${select.id}-value`;
    trigger.setAttribute('aria-labelledby', `${label.id} ${value.id}`);
    trigger.append(value);
    const list = document.createElement('div');
    list.id = `${select.id}-options`;
    list.className = 'paper-select-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', label.id);
    list.hidden = true;
    trigger.setAttribute('aria-controls', list.id);
    wrapper.append(trigger, list);
    select.after(wrapper);
    select.hidden = true;
    function close() { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    function sync() {
      value.textContent = select.selectedOptions[0]?.textContent || '';
      trigger.disabled = select.disabled;
      if (select.disabled) close();
      list.replaceChildren();
      for (const option of select.options) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'paper-select-option';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.tabIndex = -1;
        item.textContent = option.textContent;
        item.disabled = option.disabled;
        item.addEventListener('click', () => {
          select.value = option.value;
          close();
          sync();
          trigger.focus();
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        list.append(item);
      }
    }
    function open() {
      controls.forEach(control => control.close());
      sync();
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      (list.querySelector('[aria-selected="true"]:not(:disabled)') || list.querySelector('button:not(:disabled)'))?.focus();
    }
    trigger.addEventListener('click', () => list.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
    });
    list.addEventListener('keydown', event => {
      const items = [...list.querySelectorAll('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    });
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) close(); });
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
    controls.push({ close, wrapper });
    sync();
  }
  document.addEventListener('click', event => controls.forEach(control => {
    if (!control.wrapper.contains(event.target)) control.close();
  }));
})();
