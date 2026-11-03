document.querySelectorAll('[data-toggle]').forEach((button) => {
  button.addEventListener('click', () =>
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')),
  );
});
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    button.parentElement
      .querySelectorAll('button')
      .forEach((tab) => tab.setAttribute('aria-pressed', String(tab === button)));
  });
});
const dialog = document.getElementById('sample-dialog');
const opener = document.getElementById('open-dialog');
opener.addEventListener('click', () => dialog.showModal());
dialog.addEventListener('close', () => opener.focus());
