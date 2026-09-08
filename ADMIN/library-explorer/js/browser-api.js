export const ALL_BLOGS_ID = "__all_blogs__";

export async function request(url, options = {}) {
    const res = await fetch(url, { cache: "no-store", ...options });
    const body = await res.text();
    let data;
    try {
        data = body.trim() ? JSON.parse(body) : {};
    } catch {
        throw new Error(`Invalid server response (${res.status})`);
    }
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export function post(action, body) {
    return request(`/api/library-fs/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function getTree(lib, sub = "") {
    return request(`/api/library-tree?${new URLSearchParams({ lib, sub })}`);
}

export function isPrivate(library) {
    return library.private === true || library.hidden === true;
}

export async function allBlogs() {
    const libraries = await request("/api/blog-list");
    if (!Array.isArray(libraries)) throw new Error("Invalid blog list");
    return {
        type: "virtual",
        items: libraries.flatMap(library => (library.blogs || []).map(blog => {
            const parts = blog.slugPath || [];
            return {
                ...blog,
                type: "blog",
                lib: library.libraryPath,
                name: parts.at(-1) || library.libraryPath,
                displayName: blog.displayName || blog.name,
                sub: parts.slice(0, -1).join("/"),
                root: parts.length === 0,
            };
        })),
    };
}