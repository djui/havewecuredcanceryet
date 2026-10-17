// The page works without this file. It only adds the visitor's date and the share buttons.

const today = document.querySelector(".today");
if (today) {
  const now = new Date();
  today.dateTime = now.toISOString().slice(0, 10);
  today.textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const copy = document.querySelector(".copy-link");
copy?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(copy.dataset.url);
    copy.textContent = "Copied";
  } catch {
    copy.textContent = copy.dataset.url;
  }
  setTimeout(() => (copy.textContent = "Copy link"), 2500);
});

const share = document.querySelector(".share-native");
if (share && navigator.share) {
  share.hidden = false;
  share.addEventListener("click", () =>
    navigator
      .share({
        title: "Have we cured cancer yet?",
        text: "No. Here's what we pointed AI at instead.",
        url: copy?.dataset.url ?? location.href,
      })
      .catch(() => {}),
  );
}
