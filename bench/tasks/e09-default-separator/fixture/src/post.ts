import { joinList } from './list.ts';

export type Post = { title: string; tags: string[] };

export function postLine(post: Post): string {
  return post.tags.length === 0 ? post.title : `${post.title} [${joinList(post.tags, ' · ')}]`;
}
