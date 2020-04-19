function surpriseMe() {
    var num_links = document.links.length;
    var anchor_index = Math.round(Math.random() * num_links)
    window.location.href = document.links[anchor_index].href
}