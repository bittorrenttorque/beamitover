Local:

    npm install
    bower install
    echo FACEBOOK_APP_ID=12345 >> .env
    echo FACEBOOK_SECRET=abcde >> .env
    foreman start

Heroku:

    heroku create --stack cedar
    git push heroku master
    heroku config:add FACEBOOK_APP_ID=12345 FACEBOOK_SECRET=abcde

Enter the URL for your Heroku app into the Website URL section of the Facebook app settings page, hen you can visit your app on the web.

