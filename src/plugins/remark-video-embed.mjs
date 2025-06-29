import { visit } from 'unist-util-visit'

export function remarkVideoEmbed() {
  return (tree) => {
    visit(tree, 'leafDirective', (node) => {
      if (node.name !== 'youtube' && node.name !== 'bilibili') {
        return
      }

      // YouTube
      if (node.name === 'youtube') {
        const videoId = node.attributes?.id ?? ''
        if (!videoId) {
          console.warn(`Missing YouTube video ID`)
          return
        }

        node.type = 'html'
        node.value = `
        <figure>
          <lite-youtube videoid="${videoId}"></lite-youtube>
        </figure>
        `

        delete node.name
        delete node.attributes
        delete node.children
      }

      // Bilibili
      else {
        const bvid = node.attributes?.id ?? ''
        if (!bvid) {
          console.warn(`Missing Bilibili video ID`)
          return
        }

        node.type = 'html'
        node.value = `
        <figure>
          <iframe
            src="//player.bilibili.com/player.html?isOutside=true&bvid=${bvid}&p=1&autoplay=0&muted=false"
            scrolling="no"
            border="0"
            frameborder="no"
            framespacing="0"
            allowfullscreen="true"
          ></iframe>
        </figure>
        `

        delete node.name
        delete node.attributes
        delete node.children
      }
    })
  }
}
