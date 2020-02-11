import {h} from 'preact'

const StakingBanner = ({closeBanner}) =>
  h(
    'div',
    {class: 'banner'},
    h(
      'div',
      {class: 'banner-text'},
      'Staking with Adalite is out! ',
      h(
        'a',
        {
          href: '#',
          onClick: (e) => {
            e.preventDefault()
            window.history.pushState({}, 'staking', 'staking')
          },
        },
        'Read more'
      )
    ),
    h('button', {
      'class': 'button close banner-close',
      'aria-label': 'Close banner',
      'onclick': (e) => {
        closeBanner()
      },
    })
  )

export default StakingBanner
