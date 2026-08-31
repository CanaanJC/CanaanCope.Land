
export const ABOUT_ME_URL_PATH = "aboutme";
export const ABOUT_ME_NAME = "About Me";

export function makeAboutMeBlog() {
    return {
        name: ABOUT_ME_NAME,
        displayName: ABOUT_ME_NAME,
        urlPath: ABOUT_ME_URL_PATH,
        isAboutMe: true,
    };
}

export function isAboutMeBlog(blog) {
    return !!blog && (blog.isAboutMe === true || blog.urlPath === ABOUT_ME_URL_PATH);
}
