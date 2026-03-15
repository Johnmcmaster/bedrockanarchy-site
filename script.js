const copyButtons = document.querySelectorAll(".copy-ip");

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const previous = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1400);
  } catch {
    button.textContent = value;
  }
}

copyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    copyText(button.dataset.copy ?? "", button);
  });
});
