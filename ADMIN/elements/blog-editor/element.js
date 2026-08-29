export default function init(root) {
    const btn = root.querySelector("#be-open-btn");
    btn.addEventListener("click", () => {
        window.location.href = "/blog-editor";
    });
}
