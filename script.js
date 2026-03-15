const copyButtons = document.querySelectorAll(".copy-ip");

function legacyCopy(value) {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(area);
  return copied;
}

async function copyText(value, button) {
  if (!value) {
    return;
  }

  const previous = button.textContent;
  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      copied = true;
    } else {
      copied = legacyCopy(value);
    }
  } catch {
    copied = legacyCopy(value);
  }

  if (!copied) {
    window.prompt("Copy this address:", value);
  }

  button.textContent = copied ? "Copied" : "Copy shown";
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1400);
}

copyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    copyText(button.dataset.copy ?? "", button);
  });
});