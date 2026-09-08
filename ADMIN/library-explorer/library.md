# Library Explorer

## Blogs and folders

* A directory containing config.json is a blog. Its descendants are not scanned.
* Other directories are library folders, described by folder.json.
* Blogs and folders can coexist at any depth. A library root can itself be a blog.
* Media directories are not library folders.
* Select a blog to edit its config inline or open its content editor.
* Open a folder to edit its folder.json inline, including empty folders and library roots.
* About Me has content and media only. It has no config.json.

## Ordering

* The explorer uses the server's existing sortOrder.js implementation.
* Blogs and folders are ordered independently, with blogs displayed first.
* In dated libraries, blogs use the last date in their date array, newest first. Undated blogs follow, ordered by goAfter.
* In non-dated libraries, blogs and folders use goAfter.
* first_blog pins an entry to the beginning of its sibling group.
* Other goAfter values identify a sibling by its raw folder name, not its displayed title.
* Blank, invalid and self-referencing values use the server's fallback ordering.
* Labels come from name, falling back to the raw folder name. Underscores are not stripped.

## Drag sorting

* Drag above or below an entry of the same type in the same folder.
* Reordering saves automatically and repairs the sibling chain, including the old and new neighbours.
* Save pending config edits before dragging.
* Blog and folder dragging is disabled throughout dated libraries, including undated blogs.
* All Blogs is a virtual view and cannot be reordered.
* Library rows can still be dragged to reorder libraries.

## Creating and moving

* New blogs use private, not block.
* The first entry receives goAfter: first_blog. Later entries follow the last sorted sibling of the same type.
* Non-dated sibling chains are normalized when appending so existing unspecified entries keep their positions.
* Date-driven placement still takes precedence in dated libraries.
* Right-click to rename, move or delete. Move Here accepts any real container folder, never a blog or a folder's own descendants.
* Renaming repairs sibling references. Moving and deleting repair affected ordering chains.
* Root blogs are managed through their library rather than renamed or moved as child entries.

## Private entries

* Private libraries and blogs remain visible in the admin explorer.
* Private entries are omitted from public listings but remain directly reachable.
* Legacy hidden on a library is read as private; changing its visibility migrates that flag.
* Legacy hidden on a blog is ignored.