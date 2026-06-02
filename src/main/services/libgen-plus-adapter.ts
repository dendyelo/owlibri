import { Entry } from "./entry";
import { nanoid } from "nanoid";
import { clearText } from "./utilities";

export class LibgenPlusAdapter {
  baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  parseEntries(document: Document): Entry[] {
    const entries: Entry[] = [];
    const containerTable = document.querySelector("#tablelibgen > tbody");

    if (!containerTable) {
      return [];
    }

    const entryElements = containerTable.children;

    for (const element of entryElements) {
      const id = nanoid();
      const authors = clearText(element.children[1]?.textContent || "")
        .split(";")
        .map((author) => author.trim())
        .join(", ");
      
      const titleSectionContent = [...(element.children[0]?.children || [])]
        .filter((child) => child.nodeName !== "NOBR")
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .join(" / ");
      
      const title = clearText(titleSectionContent || "");
      const publisher = clearText(element.children[2]?.textContent || "");
      const year = clearText(element.children[3]?.textContent || "");
      const pages = clearText(element.children[5]?.textContent || "");
      const language = clearText(element.children[4]?.textContent || "");
      
      const sizeLinkElement = element.children[6]?.getElementsByTagName("a")?.[0];
      const sizeHref = sizeLinkElement?.getAttribute("href") || "";
      const dbIdParam = sizeHref.split("id=")[1] || "";
      const dbId = dbIdParam.trim();

      const size = clearText(element.children[6]?.textContent || "");
      const extension = clearText(element.children[7]?.textContent || "");
      const mirror =
        element.children[8]?.getElementsByTagName("a")?.[0]?.getAttribute("href") || "";

      // Extract cover image info
      let coverUrl = "";
      const mirrorHref = element.children[8]?.getElementsByTagName("a")?.[0]?.getAttribute("href") || "";
      const md5Match = mirrorHref.match(/md5=([a-fA-F0-9]{32})/);
      const md5 = md5Match ? md5Match[1] : "";

      if (md5) {
        const badges = element.children[0]?.querySelectorAll(".badge-secondary, .badge");
        let idType = ""; // "l" or "f"
        let libgenId = "";
        
        for (const badge of badges) {
          const text = badge.textContent || "";
          const match = text.match(/([lf])\s+(\d+)/);
          if (match) {
            idType = match[1]; // "l" or "f"
            libgenId = match[2];
            break;
          }
        }

        if (libgenId) {
          const numericId = parseInt(libgenId, 10);
          if (!isNaN(numericId)) {
            const folderId = Math.floor(numericId / 1000) * 1000;
            const folderName = idType === "f" ? "fictioncovers" : "covers";
            coverUrl = `/${folderName}/${folderId}/${md5}.jpg`;
          }
        }
      }

      entries.push({
        id,
        dbId,
        authors,
        title,
        publisher,
        year,
        pages,
        language,
        size,
        extension,
        mirror,
        coverUrl,
      });
    }

    return entries;
  }

  getPageURL(pathname: string): string {
    if (pathname.startsWith("http")) {
      return pathname;
    }
    const url = new URL(pathname, this.baseURL);
    return url.toString();
  }

  getSearchURL(query: string, pageNumber: number, pageSize: number): string {
    const url = new URL("/index.php", this.baseURL);
    url.searchParams.set("req", query);
    url.searchParams.set("page", pageNumber.toString());
    url.searchParams.set("res", pageSize.toString());
    return url.toString();
  }

  parseSearchPagination(document: Document, fallbackPage: number, fallbackPageSize: number) {
    const paginationScript = [...document.querySelectorAll("script")].find((script) => {
      return script.textContent?.includes("new Paginator(");
    })?.textContent || "";

    const paginatorMatch = paginationScript.match(
      /new Paginator\("([^"]+)",\s*(\d+),\s*(\d+),\s*(\d+),\s*"([^"]*)"\s*\)/,
    );

    const totalPages = paginatorMatch ? Number.parseInt(paginatorMatch[2], 10) || fallbackPage : fallbackPage;
    const pageCurrent = paginatorMatch ? Number.parseInt(paginatorMatch[4], 10) || fallbackPage : fallbackPage;

    const activeTabBadge = document.querySelector("ul.nav-tabs a.nav-link.active .badge");
    const totalResultsText = activeTabBadge?.textContent?.trim() || "";
    const totalResults = Number.parseInt(totalResultsText, 10);

    return {
      currentPage: pageCurrent > 0 ? pageCurrent : fallbackPage,
      pageSize: fallbackPageSize,
      totalPages: totalPages > 0 ? totalPages : fallbackPage,
      totalResults: Number.isFinite(totalResults) ? totalResults : undefined,
      hasNextPage: (pageCurrent > 0 ? pageCurrent : fallbackPage) < (totalPages > 0 ? totalPages : fallbackPage),
      hasPreviousPage: (pageCurrent > 0 ? pageCurrent : fallbackPage) > 1,
    };
  }

  getDetailPageURL(md5: string): string {
    const url = new URL("/ads.php", this.baseURL);
    url.searchParams.set("md5", md5);
    return url.toString();
  }

  getMainDownloadURLFromDocument(document: Document): string | undefined {
    const downloadLinkElement = document.querySelector(
      "#main > tr:first-child > td:nth-child(2) > a"
    );

    if (!downloadLinkElement) {
      return undefined;
    }

    const href = downloadLinkElement.getAttribute("href");
    return this.getPageURL(href || "");
  }
}
